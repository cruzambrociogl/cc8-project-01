// PRFC-CC8-2026 v3.0 — binary game server (Part 2 demo)
//
//   node server.js [port] [minPlayers] [countdownSeconds]
//
// Scope: enough of the §30 tick cycle to CONFIRM binary communication —
// JOIN handshake, GAME_STARTED config, INPUT -> position moves in GAME_STATE,
// INTERACT -> flag events, disconnect -> PLAYER_DISCONNECTED. Not a polished game.
//
// Authority model: server owns all state, integrates fixed-point positions at
// 20 tps, validates everything. Positions are stored as fixed-point i32 (×100)
// so what goes on the wire is exact; internal distance math uses floats (allowed,
// enmiendas B.3).

import net from "node:net";
import {
  encode, decode, frame, StreamFramer, DecodeError,
  MSG, DIRECTION, FLAG_STATUS, MATCH_STATE, REJECT_REASON, GAME_OVER_REASON, ERROR_CODE,
  toFixed, fromFixed,
} from "./protocol.js";

const PORT = Number(process.argv[2] ?? 5000);
const MIN_PLAYERS = Number(process.argv[3] ?? 0);       // 0 = host-controlled (press ENTER); >=1 = auto-start
const COUNTDOWN = Number(process.argv[4] ?? 3);
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS ?? 10000); // §22.1 / B.1

// §21 config (world units). Sent (×100) in GAME_STARTED; clients must read it.
const CFG = {
  gameId: 1, serverName: "demo-team9",
  mapSize: 2000, circleRadius: 500, playerRadius: 15, spawnMargin: 80,
  playerSpeed: 220, interactionRadius: 60, tickIntervalMs: 50,
};
const STEP_FIXED = toFixed((CFG.playerSpeed * CFG.tickIntervalMs) / 1000); // §10/A.4
const HALF_FIXED = toFixed(CFG.mapSize / 2);

let state = MATCH_STATE.WAITING;
let tick = 0;
let nextPlayerId = 1;                                    // B.2: from 1, never reused
const players = new Map();                               // playerId -> player
const conns = new Set();                                 // all live connections (for idle sweep)
const flag = { status: FLAG_STATUS.AVAILABLE, carrierId: 0, x: 0, y: 0 };
let loop = null;

const log = (...a) => console.log(...a);

// --- wire helpers -------------------------------------------------------------
function send(sock, msg) { sock.write(frame(encode(msg))); }
function broadcast(msg, exceptId = null) {
  for (const p of players.values()) if (p.id !== exceptId && p.socket.writable) send(p.socket, msg);
}
const worldDist = (ax, ay, bx, by) => Math.hypot(fromFixed(ax - bx), fromFixed(ay - by));

// --- lobby / start ------------------------------------------------------------
function sendLobby() {
  broadcast({
    type: "LOBBY_STATE", state,
    players: [...players.values()].map((p) => ({ playerId: p.id, name: p.name })),
  });
}

function spawn() {
  const a = Math.random() * Math.PI * 2;
  const r = CFG.circleRadius + CFG.spawnMargin;
  return { x: toFixed(Math.cos(a) * r), y: toFixed(Math.sin(a) * r) };
}

function maybeAutoStart() {
  if (MIN_PLAYERS >= 1 && state === MATCH_STATE.WAITING && players.size >= MIN_PLAYERS) startCountdown();
}
function hostPrompt() {
  if (state === MATCH_STATE.WAITING && MIN_PLAYERS < 1)
    log(`  ${players.size} player(s) in lobby — press ENTER to start`);
}

function startCountdown() {
  if (state !== MATCH_STATE.WAITING || players.size < 1) return;
  state = MATCH_STATE.STARTING;
  log(`state -> STARTING (${players.size} players), countdown ${COUNTDOWN}s`);
  let n = COUNTDOWN;
  const tickDown = () => {
    if (n <= 0) return startMatch();
    broadcast({ type: "GAME_COUNTDOWN", secondsRemaining: n });
    n--;
    setTimeout(tickDown, 1000);
  };
  tickDown();
}

function startMatch() {
  for (const p of players.values()) { const s = spawn(); p.x = s.x; p.y = s.y; p.direction = DIRECTION.NONE; p.hasFlag = false; }
  flag.status = FLAG_STATUS.AVAILABLE; flag.carrierId = 0; flag.x = 0; flag.y = 0;
  state = MATCH_STATE.RUNNING; tick = 0;
  broadcast({
    type: "GAME_STARTED",
    mapSize: toFixed(CFG.mapSize), circleRadius: toFixed(CFG.circleRadius), playerRadius: toFixed(CFG.playerRadius),
    playerSpeed: toFixed(CFG.playerSpeed), interactionRadius: toFixed(CFG.interactionRadius), tickIntervalMs: CFG.tickIntervalMs,
    flagStatus: flag.status, flagCarrierId: flag.carrierId, flagX: flag.x, flagY: flag.y,
    players: [...players.values()].map((p) => ({ playerId: p.id, name: p.name, x: p.x, y: p.y, direction: p.direction, hasFlag: p.hasFlag })),
  });
  log(`state -> RUNNING, ${players.size} players, step=${STEP_FIXED} fixed/tick`);
  loop = setInterval(runTick, CFG.tickIntervalMs);
}

// --- the §30 tick cycle -------------------------------------------------------
function runTick() {
  tick++;
  const events = [];

  // 1-2. apply latest INPUT direction (already stored on the player)
  // 3-5. move + clip
  for (const p of players.values()) {
    if (p.direction === DIRECTION.UP) p.y -= STEP_FIXED;
    else if (p.direction === DIRECTION.DOWN) p.y += STEP_FIXED;
    else if (p.direction === DIRECTION.LEFT) p.x -= STEP_FIXED;
    else if (p.direction === DIRECTION.RIGHT) p.x += STEP_FIXED;
    p.x = Math.max(-HALF_FIXED, Math.min(HALF_FIXED, p.x));
    p.y = Math.max(-HALF_FIXED, Math.min(HALF_FIXED, p.y));
  }

  // 6-7. resolve INTERACT: one flag-ownership change per tick, ascending playerId (§15)
  const interactors = [...players.values()].filter((p) => p.wantsInteract).sort((a, b) => a.id - b.id);
  for (const p of players.values()) p.wantsInteract = false;
  const inRange = (p, tx, ty) => worldDist(p.x, p.y, tx, ty) <= CFG.interactionRadius;
  if (flag.status === FLAG_STATUS.CARRIED) {
    const carrier = players.get(flag.carrierId);
    const thief = interactors.find((p) => carrier && p.id !== carrier.id && inRange(p, carrier.x, carrier.y));
    if (thief) {
      carrier.hasFlag = false; thief.hasFlag = true; flag.carrierId = thief.id;
      events.push({ type: "FLAG_STOLEN", tick, previousCarrierId: carrier.id, newCarrierId: thief.id });
    }
  } else {
    const taker = interactors.find((p) => inRange(p, flag.x, flag.y));
    if (taker) {
      taker.hasFlag = true; flag.status = FLAG_STATUS.CARRIED; flag.carrierId = taker.id;
      events.push({ type: "FLAG_PICKED_UP", tick, playerId: taker.id });
    }
  }

  // flag follows carrier
  if (flag.status === FLAG_STATUS.CARRIED) { const c = players.get(flag.carrierId); if (c) { flag.x = c.x; flag.y = c.y; } }

  // 9. victory (§16): carrier fully outside the circle
  let winner = null;
  if (flag.status === FLAG_STATUS.CARRIED) {
    const c = players.get(flag.carrierId);
    if (c && worldDist(c.x, c.y, 0, 0) - CFG.playerRadius > CFG.circleRadius) winner = c;
  }

  // 11. send events (ascending playerId already), then GAME_STATE
  for (const ev of events) broadcast(ev);
  broadcast(gameStateMsg());

  if (winner) {
    flag.status = FLAG_STATUS.OUTSIDE;
    state = MATCH_STATE.FINISHED;
    clearInterval(loop); loop = null;
    broadcast({ type: "GAME_OVER", winnerId: winner.id, winnerName: winner.name, reason: GAME_OVER_REASON.EXITED_CIRCLE_WITH_FLAG });
    log(`state -> FINISHED, winner ${winner.id} "${winner.name}" at tick ${tick}`);
  }
}

function gameStateMsg() {
  return {
    type: "GAME_STATE", tick, flagStatus: flag.status, flagCarrierId: flag.carrierId, flagX: flag.x, flagY: flag.y,
    players: [...players.values()].map((p) => ({ playerId: p.id, x: p.x, y: p.y, direction: p.direction, hasFlag: p.hasFlag })),
  };
}

// --- per-message handling -----------------------------------------------------
function handle(conn, msg) {
  if (msg.type === "__BAD_VERSION__") { send(conn.socket, { type: "ERROR", code: ERROR_CODE.UNSUPPORTED_PROTOCOL_VERSION, description: "" }); conn.socket.destroy(); return; }
  if (msg.type === "__UNKNOWN__") { log(`  (skipped unknown type 0x${msg.code.toString(16)})`); return; } // A.1

  const p = conn.playerId != null ? players.get(conn.playerId) : null;

  switch (msg.type) {
    case "JOIN": {
      if (conn.playerId != null) return; // ignore duplicate join
      if (state !== MATCH_STATE.WAITING) { send(conn.socket, { type: "JOIN_REJECTED", reason: REJECT_REASON.GAME_ALREADY_STARTED }); conn.socket.destroy(); return; }
      const name = (msg.name ?? "").trim();
      const nameBytes = new TextEncoder().encode(name).length;              // A.2: bytes
      if (nameBytes < 1 || nameBytes > 20) { send(conn.socket, { type: "JOIN_REJECTED", reason: REJECT_REASON.INVALID_NAME }); conn.socket.destroy(); return; }
      const id = nextPlayerId++;
      conn.playerId = id;
      players.set(id, { id, name, x: 0, y: 0, direction: DIRECTION.NONE, hasFlag: false, wantsInteract: false, socket: conn.socket });
      send(conn.socket, { type: "JOIN_ACCEPTED", playerId: id, gameId: CFG.gameId });
      sendLobby();
      log(`+ P${id} "${name}" joined (${players.size} online)`);
      maybeAutoStart();
      hostPrompt();
      break;
    }
    case "INPUT": {
      if (!p || state !== MATCH_STATE.RUNNING) return;
      p.direction = msg.direction >= 0 && msg.direction <= 4 ? msg.direction : DIRECTION.NONE;
      break;
    }
    case "INTERACT": {
      if (!p || state !== MATCH_STATE.RUNNING) return;
      p.wantsInteract = true; // one per tick (dedup via boolean)
      break;
    }
    case "LEAVE": { conn.socket.destroy(); break; }
    default: break;
  }
}

function dropConn(conn) {
  const id = conn.playerId;
  if (id != null && players.delete(id)) {
    if (flag.status === FLAG_STATUS.CARRIED && flag.carrierId === id) { flag.status = FLAG_STATUS.DROPPED; flag.carrierId = 0; }
    broadcast({ type: "PLAYER_DISCONNECTED", playerId: id });
    if (state === MATCH_STATE.WAITING) { sendLobby(); hostPrompt(); }
    log(`- P${id} left (${players.size} online)`);
  }
}

// --- connection lifecycle -----------------------------------------------------
const server = net.createServer((socket) => {
  socket.setNoDelay(true);
  const conn = { socket, playerId: null, framer: new StreamFramer(), lastSeen: Date.now() };
  conns.add(conn);

  socket.on("data", (chunk) => {
    conn.lastSeen = Date.now();                          // any byte keeps the connection alive (§22.1)
    let bodies;
    try { bodies = conn.framer.push(new Uint8Array(chunk)); }
    catch { send(socket, { type: "ERROR", code: ERROR_CODE.INVALID_ENCODING, description: "" }); socket.destroy(); return; }
    for (const body of bodies) {
      let msg;
      try { msg = decode(body); }
      catch (e) {
        if (e instanceof DecodeError) { send(socket, { type: "ERROR", code: ERROR_CODE.INVALID_ENCODING, description: "" }); socket.destroy(); return; } // A.1
        throw e;
      }
      handle(conn, msg);
    }
  });
  const cleanup = () => { conns.delete(conn); dropConn(conn); };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

// §22.1 / B.1: drop connections that go silent (dead-but-open sockets).
setInterval(() => {
  const now = Date.now();
  for (const c of conns) {
    if (now - c.lastSeen > IDLE_TIMEOUT_MS) {
      log(`  idle timeout, dropping ${c.playerId != null ? `P${c.playerId}` : "unjoined conn"}`);
      c.socket.destroy();
    }
  }
}, 1000);

// §20: the host (server operator) starts the match locally by pressing ENTER.
process.stdin.on("data", () => startCountdown());

server.listen(PORT, "0.0.0.0", () => {
  log(`v3 binary server on 0.0.0.0:${PORT}`);
  log(MIN_PLAYERS >= 1
    ? `  auto-start at ${MIN_PLAYERS} player(s) — or press ENTER`
    : `  host-controlled: press ENTER to start the match when players have joined`);
});
