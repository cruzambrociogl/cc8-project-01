// PRFC-CC8-2026 v3.0 — headless bot client (Part 2 demo / test)
//
//   node bot.js <name> [host] [port]
//
// A real binary client over raw TCP. Confirms communication both ways:
// sends JOIN/INPUT/INTERACT, receives and decodes the whole server stream, and
// heads for the flag so the full event chain (FLAG_PICKED_UP, GAME_OVER) fires.

import net from "node:net";
import {
  encode, decode, frame, StreamFramer, DIRECTION, FLAG_STATUS, fromFixed,
} from "./protocol.js";

const NAME = process.argv[2] ?? "bot";
const HOST = process.argv[3] ?? "127.0.0.1";
const PORT = Number(process.argv[4] ?? 5000);

let myId = null, cfg = null, dir = DIRECTION.NONE, me = null, flag = null, stateCount = 0;
const tag = (s) => `[${NAME}] ${s}`;
const log = (s) => console.log(tag(s));

const sock = net.createConnection({ host: HOST, port: PORT }, () => {
  sock.setNoDelay(true);
  log(`connected -> ${HOST}:${PORT}, sending JOIN`);
  send({ type: "JOIN", name: NAME });
});
const framer = new StreamFramer();
function send(msg) { sock.write(frame(encode(msg))); }

// choose a 4-dir heading toward a target (or away, to exit with the flag)
function headingToward(tx, ty, away = false) {
  const dx = tx - me.x, dy = ty - me.y;
  let d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT)
                                      : (dy > 0 ? DIRECTION.DOWN : DIRECTION.UP);
  if (away) d = { [DIRECTION.UP]: DIRECTION.DOWN, [DIRECTION.DOWN]: DIRECTION.UP, [DIRECTION.LEFT]: DIRECTION.RIGHT, [DIRECTION.RIGHT]: DIRECTION.LEFT }[d];
  return d;
}
function setDir(d) { if (d !== dir) { dir = d; send({ type: "INPUT", playerId: myId, direction: d }); } }

function think() {
  if (!cfg || !me || !flag) return;
  const haveFlag = me.hasFlag;
  const target = haveFlag ? { x: 0, y: 0 } : { x: flag.x, y: flag.y };
  setDir(headingToward(target.x, target.y, haveFlag)); // toward flag, or away from center to win
  const distToFlag = Math.hypot(me.x - flag.x, me.y - flag.y);
  if (!haveFlag && distToFlag <= cfg.interactionRadius + 1) send({ type: "INTERACT", playerId: myId });
}

sock.on("data", (chunk) => {
  for (const body of framer.push(new Uint8Array(chunk))) {
    const m = decode(body);
    switch (m.type) {
      case "JOIN_ACCEPTED":
        myId = m.playerId;
        log(`RECV JOIN_ACCEPTED -> I am P${myId} (game ${m.gameId})`);
        break;
      case "LOBBY_STATE":
        log(`RECV LOBBY_STATE -> ${m.players.map((p) => `P${p.playerId}:${p.name}`).join(", ")}`);
        break;
      case "GAME_COUNTDOWN": log(`RECV GAME_COUNTDOWN ${m.secondsRemaining}`); break;
      case "GAME_STARTED":
        cfg = { interactionRadius: fromFixed(m.interactionRadius), circleRadius: fromFixed(m.circleRadius) };
        flag = { x: fromFixed(m.flagX), y: fromFixed(m.flagY) };
        me = m.players.find((p) => p.playerId === myId);
        me = { x: fromFixed(me.x), y: fromFixed(me.y), hasFlag: me.hasFlag };
        log(`RECV GAME_STARTED -> map/circle/flag config received, I spawn at (${me.x.toFixed(0)}, ${me.y.toFixed(0)})`);
        break;
      case "GAME_STATE": {
        stateCount++;
        const mp = m.players.find((p) => p.playerId === myId);
        if (mp) { me = { x: fromFixed(mp.x), y: fromFixed(mp.y), hasFlag: mp.hasFlag }; }
        flag = { x: fromFixed(m.flagX), y: fromFixed(m.flagY), status: m.flagStatus };
        if (stateCount <= 2 || stateCount % 20 === 0)
          log(`RECV GAME_STATE #${m.tick} -> me(${me.x.toFixed(0)},${me.y.toFixed(0)}) hasFlag=${me.hasFlag} players=${m.players.length}`);
        think();
        break;
      }
      case "FLAG_PICKED_UP": log(`RECV FLAG_PICKED_UP by P${m.playerId} @tick ${m.tick}`); break;
      case "FLAG_STOLEN": log(`RECV FLAG_STOLEN P${m.previousCarrierId} -> P${m.newCarrierId} @tick ${m.tick}`); break;
      case "PLAYER_DISCONNECTED": log(`RECV PLAYER_DISCONNECTED P${m.playerId}`); break;
      case "JOIN_REJECTED": log(`RECV JOIN_REJECTED reason=${m.reason}`); break;
      case "GAME_OVER": log(`RECV GAME_OVER -> winner P${m.winnerId} "${m.winnerName}"`); sock.end(); break;
      case "ERROR": log(`RECV ERROR code=${m.code} "${m.description}"`); break;
      default: log(`RECV ${m.type}`);
    }
  }
});
sock.on("close", () => log(`disconnected (received ${stateCount} GAME_STATE messages)`));
sock.on("error", (e) => log(`socket error: ${e.message}`));
