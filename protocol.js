// PRFC-CC8-2026 v3.0 — binary codec (Part 2, foundation)
//
// One environment-agnostic module: works in the Node server, the Node bridge,
// and the browser client (uses only Uint8Array / TextEncoder / TextDecoder).
//
// Design decisions (see enmiendas Parte 1):
//  - All multi-byte integers are BIG-ENDIAN (network order), §23.1.
//  - `str` length is a u8 counting UTF-8 BYTES, not characters (A.2).
//  - Message objects carry WIRE-DOMAIN values: coordinates are already
//    fixed-point i32 (world units × 100). The codec does NO unit conversion —
//    use toFixed()/fromFixed() at the game-logic and rendering edges. This keeps
//    the codec a pure (object <-> bytes) mapping and makes the golden bytes exact.
//  - encode(msg) -> body bytes (header included, NO length prefix).
//    frame(body) -> length-prefixed bytes for TCP (§23.2).
//    decode(body) -> msg object.
//    Framing errors throw DecodeError -> caller sends INVALID_ENCODING + closes
//    (A.1). Unknown-but-framed type -> {type:'__UNKNOWN__'} -> caller skips (A.1).

export const VERSION = 3;

export const MSG = {
  DISCOVER_REQUEST: 0x01, DISCOVER_RESPONSE: 0x02,
  JOIN: 0x10, INPUT: 0x11, INTERACT: 0x12, LEAVE: 0x13,
  JOIN_ACCEPTED: 0x20, JOIN_REJECTED: 0x21, LOBBY_STATE: 0x22,
  GAME_COUNTDOWN: 0x23, GAME_STARTED: 0x24, GAME_STATE: 0x25,
  FLAG_PICKED_UP: 0x26, FLAG_STOLEN: 0x27, PLAYER_DISCONNECTED: 0x28,
  GAME_OVER: 0x29, ERROR: 0x2a,
};
export const MSG_NAME = Object.fromEntries(Object.entries(MSG).map(([k, v]) => [v, k]));

export const DIRECTION = { NONE: 0, UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 };
export const FLAG_STATUS = { AVAILABLE: 1, CARRIED: 2, DROPPED: 3, OUTSIDE: 4 };
export const MATCH_STATE = { WAITING: 1, STARTING: 2, RUNNING: 3, FINISHED: 4, CANCELLED: 5 };
export const REJECT_REASON = { GAME_ALREADY_STARTED: 1, GAME_FULL: 2, INVALID_NAME: 3, UNSUPPORTED_PROTOCOL_VERSION: 4 };
export const GAME_OVER_REASON = { EXITED_CIRCLE_WITH_FLAG: 1 };
export const ERROR_CODE = {
  INVALID_MESSAGE: 1, INVALID_ENCODING: 2, INVALID_INPUT: 3, UNKNOWN_PLAYER: 4,
  GAME_NOT_STARTED: 5, GAME_ALREADY_STARTED: 6, GAME_FINISHED: 7, UNSUPPORTED_PROTOCOL_VERSION: 8,
};

export class DecodeError extends Error {}

// --- fixed-point helpers (§24, A.4: round half away from zero) ----------------
export function toFixed(world) {
  const a = Math.round(Math.abs(world * 100));
  return world < 0 ? -a : a;
}
export const fromFixed = (fx) => fx / 100;

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8", { fatal: false });

// --- byte writer (big-endian) -------------------------------------------------
class Writer {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 0xff); return this; }
  bool(v) { this.b.push(v ? 1 : 0); return this; }
  u16(v) { this.b.push((v >>> 8) & 0xff, v & 0xff); return this; }
  u32(v) { v >>>= 0; this.b.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff); return this; }
  i16(v) { const u = v & 0xffff; this.b.push((u >>> 8) & 0xff, u & 0xff); return this; }
  i32(v) { return this.u32(v >>> 0); } // >>>0 gives two's-complement u32
  str(s) {
    const bytes = ENC.encode(s ?? "");
    if (bytes.length > 255) throw new DecodeError("str exceeds 255 bytes");
    this.u8(bytes.length);
    for (const x of bytes) this.b.push(x);
    return this;
  }
  bytes() { return Uint8Array.from(this.b); }
}

// --- byte reader (big-endian, bounds-checked) ---------------------------------
class Reader {
  constructor(bytes) { this.d = bytes; this.o = 0; }
  need(n) { if (this.o + n > this.d.length) throw new DecodeError("unexpected end of message"); }
  u8() { this.need(1); return this.d[this.o++]; }
  bool() { return this.u8() !== 0; }
  u16() { this.need(2); const v = (this.d[this.o] << 8) | this.d[this.o + 1]; this.o += 2; return v; }
  u32() { this.need(4); const b = this.d, o = this.o; this.o += 4; return b[o] * 16777216 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  i16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  i32() { const v = this.u32(); return v >= 0x80000000 ? v - 0x100000000 : v; }
  str() { const n = this.u8(); this.need(n); const s = DEC.decode(this.d.subarray(this.o, this.o + n)); this.o += n; return s; }
  atEnd() { return this.o === this.d.length; }
}

// --- encode -------------------------------------------------------------------
export function encode(msg) {
  const code = MSG[msg.type];
  if (code === undefined) throw new DecodeError(`unknown message type "${msg.type}"`);
  const w = new Writer().u8(code).u8(VERSION);

  switch (msg.type) {
    case "DISCOVER_REQUEST": break;
    case "DISCOVER_RESPONSE":
      w.u16(msg.gameId).str(msg.serverName).u16(msg.tcpPort).u8(msg.state).u16(msg.playerCount).u16(msg.maximumPlayers);
      break;
    case "JOIN": w.str(msg.name); break;
    case "INPUT": w.u16(msg.playerId).u8(msg.direction); break;
    case "INTERACT": w.u16(msg.playerId); break;
    case "LEAVE": w.u16(msg.playerId); break;
    case "JOIN_ACCEPTED": w.u16(msg.playerId).u16(msg.gameId); break;
    case "JOIN_REJECTED": w.u8(msg.reason); break;
    case "LOBBY_STATE":
      w.u8(msg.state).u8(msg.players.length);
      for (const p of msg.players) w.u16(p.playerId).str(p.name);
      break;
    case "GAME_COUNTDOWN": w.u8(msg.secondsRemaining); break;
    case "GAME_STARTED":
      w.i32(msg.mapSize).i32(msg.circleRadius).i32(msg.playerRadius).i32(msg.playerSpeed).i32(msg.interactionRadius)
       .u16(msg.tickIntervalMs).u8(msg.flagStatus).u16(msg.flagCarrierId).i32(msg.flagX).i32(msg.flagY)
       .u8(msg.players.length);
      for (const p of msg.players) w.u16(p.playerId).str(p.name).i32(p.x).i32(p.y).u8(p.direction).bool(p.hasFlag);
      break;
    case "GAME_STATE":
      w.u32(msg.tick).u8(msg.flagStatus).u16(msg.flagCarrierId).i32(msg.flagX).i32(msg.flagY).u8(msg.players.length);
      for (const p of msg.players) w.u16(p.playerId).i32(p.x).i32(p.y).u8(p.direction).bool(p.hasFlag);
      break;
    case "FLAG_PICKED_UP": w.u32(msg.tick).u16(msg.playerId); break;
    case "FLAG_STOLEN": w.u32(msg.tick).u16(msg.previousCarrierId).u16(msg.newCarrierId); break;
    case "PLAYER_DISCONNECTED": w.u16(msg.playerId); break;
    case "GAME_OVER": w.u16(msg.winnerId).str(msg.winnerName).u8(msg.reason); break;
    case "ERROR": w.u8(msg.code).str(msg.description ?? ""); break;
    default: throw new DecodeError(`no encoder for "${msg.type}"`);
  }
  return w.bytes();
}

// --- decode -------------------------------------------------------------------
// Throws DecodeError on framing/decoding errors (caller: ERROR + close, A.1).
// Returns {type:'__UNKNOWN__', code, version} for a well-framed unknown type
// or wrong version (caller: skip and continue / handle version, A.1).
export function decode(bytes) {
  const r = new Reader(bytes);
  const code = r.u8();
  const version = r.u8();
  const name = MSG_NAME[code];
  if (name === undefined) return { type: "__UNKNOWN__", code, version };
  if (version !== VERSION) return { type: "__BAD_VERSION__", code, version, name };

  const m = { type: name };
  switch (name) {
    case "DISCOVER_REQUEST": break;
    case "DISCOVER_RESPONSE":
      m.gameId = r.u16(); m.serverName = r.str(); m.tcpPort = r.u16();
      m.state = r.u8(); m.playerCount = r.u16(); m.maximumPlayers = r.u16();
      break;
    case "JOIN": m.name = r.str(); break;
    case "INPUT": m.playerId = r.u16(); m.direction = r.u8(); break;
    case "INTERACT": m.playerId = r.u16(); break;
    case "LEAVE": m.playerId = r.u16(); break;
    case "JOIN_ACCEPTED": m.playerId = r.u16(); m.gameId = r.u16(); break;
    case "JOIN_REJECTED": m.reason = r.u8(); break;
    case "LOBBY_STATE": {
      m.state = r.u8();
      const n = r.u8(); m.players = [];
      for (let i = 0; i < n; i++) m.players.push({ playerId: r.u16(), name: r.str() });
      break;
    }
    case "GAME_COUNTDOWN": m.secondsRemaining = r.u8(); break;
    case "GAME_STARTED": {
      m.mapSize = r.i32(); m.circleRadius = r.i32(); m.playerRadius = r.i32();
      m.playerSpeed = r.i32(); m.interactionRadius = r.i32(); m.tickIntervalMs = r.u16();
      m.flagStatus = r.u8(); m.flagCarrierId = r.u16(); m.flagX = r.i32(); m.flagY = r.i32();
      const n = r.u8(); m.players = [];
      for (let i = 0; i < n; i++)
        m.players.push({ playerId: r.u16(), name: r.str(), x: r.i32(), y: r.i32(), direction: r.u8(), hasFlag: r.bool() });
      break;
    }
    case "GAME_STATE": {
      m.tick = r.u32(); m.flagStatus = r.u8(); m.flagCarrierId = r.u16(); m.flagX = r.i32(); m.flagY = r.i32();
      const n = r.u8(); m.players = [];
      for (let i = 0; i < n; i++)
        m.players.push({ playerId: r.u16(), x: r.i32(), y: r.i32(), direction: r.u8(), hasFlag: r.bool() });
      break;
    }
    case "FLAG_PICKED_UP": m.tick = r.u32(); m.playerId = r.u16(); break;
    case "FLAG_STOLEN": m.tick = r.u32(); m.previousCarrierId = r.u16(); m.newCarrierId = r.u16(); break;
    case "PLAYER_DISCONNECTED": m.playerId = r.u16(); break;
    case "GAME_OVER": m.winnerId = r.u16(); m.winnerName = r.str(); m.reason = r.u8(); break;
    case "ERROR": m.code = r.u8(); m.description = r.str(); break;
    default: throw new DecodeError(`no decoder for "${name}"`);
  }
  return m;
}

// --- TCP framing (§23.2: u16 big-endian length prefix) ------------------------
export function frame(body) {
  if (body.length > 65535) throw new DecodeError("message body exceeds 65535 bytes");
  const out = new Uint8Array(2 + body.length);
  out[0] = (body.length >>> 8) & 0xff;
  out[1] = body.length & 0xff;
  out.set(body, 2);
  return out;
}

// Reassembles length-prefixed messages from an arbitrarily-chunked TCP stream.
// push(chunk) -> array of complete message bodies (each still needs decode()).
export class StreamFramer {
  constructor() { this.buf = new Uint8Array(0); }
  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const out = [];
    while (this.buf.length >= 2) {
      const n = (this.buf[0] << 8) | this.buf[1];
      if (this.buf.length < 2 + n) break;
      out.push(this.buf.slice(2, 2 + n));
      this.buf = this.buf.slice(2 + n);
    }
    return out;
  }
}
