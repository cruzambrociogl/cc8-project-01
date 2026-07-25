// PRFC-CC8-2026 v3.0 — codec self-tests (§35.1-§35.4 + amendments Parte 1)
//
//   node protocol.test.js
//
// These run against the codec ALONE — no server, no other team. If they pass,
// interop is 80% won; if the golden bytes are wrong, nothing downstream matters.

import assert from "node:assert/strict";
import {
  encode, decode, frame, StreamFramer, DecodeError,
  MSG, DIRECTION, FLAG_STATUS, MATCH_STATE, REJECT_REASON, GAME_OVER_REASON, ERROR_CODE,
  toFixed, fromFixed, VERSION,
} from "./protocol.js";

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join(" ");

// §35.1 — the golden bytes. INPUT from P07 moving UP.
test("§35.1 golden bytes: INPUT P07 UP body == 11 03 00 07 01", () => {
  const body = encode({ type: "INPUT", playerId: 7, direction: DIRECTION.UP });
  assert.equal(hex(body), "11 03 00 07 01");
});

test("§35.1/A.3 framed INPUT on the wire == 00 05 11 03 00 07 01", () => {
  const body = encode({ type: "INPUT", playerId: 7, direction: DIRECTION.UP });
  assert.equal(hex(frame(body)), "00 05 11 03 00 07 01");
});

// §35.2 — every message round-trips: encode then decode returns the original.
const samples = [
  { type: "DISCOVER_REQUEST" },
  { type: "DISCOVER_RESPONSE", gameId: 1, serverName: "Partida de Ana", tcpPort: 5000, state: MATCH_STATE.WAITING, playerCount: 3, maximumPlayers: 100 },
  { type: "JOIN", name: "Pepito" },
  { type: "INPUT", playerId: 7, direction: DIRECTION.UP },
  { type: "INTERACT", playerId: 7 },
  { type: "LEAVE", playerId: 7 },
  { type: "JOIN_ACCEPTED", playerId: 7, gameId: 1 },
  { type: "JOIN_REJECTED", reason: REJECT_REASON.GAME_FULL },
  { type: "LOBBY_STATE", state: MATCH_STATE.WAITING, players: [{ playerId: 1, name: "Ana" }, { playerId: 2, name: "Beto" }] },
  { type: "GAME_COUNTDOWN", secondsRemaining: 3 },
  {
    type: "GAME_STARTED", mapSize: 200000, circleRadius: 50000, playerRadius: 1500, playerSpeed: 22000,
    interactionRadius: 6000, tickIntervalMs: 50, flagStatus: FLAG_STATUS.AVAILABLE, flagCarrierId: 0, flagX: 0, flagY: 0,
    players: [{ playerId: 1, name: "Ana", x: -41050, y: -41050, direction: DIRECTION.NONE, hasFlag: false }],
  },
  {
    type: "GAME_STATE", tick: 185, flagStatus: FLAG_STATUS.CARRIED, flagCarrierId: 7, flagX: 31840, flagY: -9510,
    players: [
      { playerId: 1, x: -12075, y: 4420, direction: DIRECTION.UP, hasFlag: false },
      { playerId: 7, x: 31840, y: -9510, direction: DIRECTION.NONE, hasFlag: true },
    ],
  },
  { type: "FLAG_PICKED_UP", tick: 90, playerId: 7 },
  { type: "FLAG_STOLEN", tick: 105, previousCarrierId: 1, newCarrierId: 7 },
  { type: "PLAYER_DISCONNECTED", playerId: 7 },
  { type: "GAME_OVER", winnerId: 7, winnerName: "Edgar", reason: GAME_OVER_REASON.EXITED_CIRCLE_WITH_FLAG },
  { type: "ERROR", code: ERROR_CODE.INVALID_INPUT, description: "El vector de movimiento no es válido." },
];
for (const m of samples) {
  test(`§35.2 round-trip: ${m.type}`, () => assert.deepEqual(decode(encode(m)), m));
}

// §35.3 — big-endian sanity: a hand-built i32 reads as the right signed value.
test("§35.3 endianness: i32 -12075 decodes correctly (not byte-swapped)", () => {
  const m = decode(encode({ type: "FLAG_PICKED_UP", tick: 1, playerId: 1 }));
  assert.equal(m.tick, 1); // u32 read as 1, not 0x01000000
  const gs = decode(encode({ type: "GAME_STATE", tick: 1, flagStatus: 1, flagCarrierId: 0, flagX: -12075, flagY: 0, players: [] }));
  assert.equal(gs.flagX, -12075);
});

// §35.4 — two messages glued together, split across arbitrary chunk boundaries.
test("§35.4 framing: two messages, delivered in awkward chunks, separate cleanly", () => {
  const a = frame(encode({ type: "INPUT", playerId: 7, direction: DIRECTION.LEFT }));
  const b = frame(encode({ type: "INTERACT", playerId: 7 }));
  const wire = new Uint8Array([...a, ...b]);
  const fr = new StreamFramer();
  const bodies = [];
  // feed one byte at a time — the worst-case TCP fragmentation
  for (const byte of wire) bodies.push(...fr.push(Uint8Array.of(byte)));
  assert.equal(bodies.length, 2);
  assert.equal(decode(bodies[0]).direction, DIRECTION.LEFT);
  assert.equal(decode(bodies[1]).type, "INTERACT");
});

// A.1 — framing/decode error is detectable (caller must ERROR + close).
test("A.1 decode throws DecodeError on a truncated body", () => {
  const body = encode({ type: "JOIN_ACCEPTED", playerId: 7, gameId: 1 }); // 6 bytes
  assert.throws(() => decode(body.subarray(0, 4)), DecodeError);
});

// A.1 — well-framed but unknown type -> skip and continue, do NOT throw.
test("A.1 unknown-but-framed type decodes to __UNKNOWN__ (no throw)", () => {
  const bogus = Uint8Array.of(0xff, VERSION, 0x00, 0x00);
  const m = decode(bogus);
  assert.equal(m.type, "__UNKNOWN__");
  assert.equal(m.code, 0xff);
});

// A.2 — str length is BYTES, not characters ("á" is 2 bytes).
test("A.2 str length counts UTF-8 bytes: 'Rosángela' round-trips", () => {
  const m = decode(encode({ type: "JOIN", name: "Rosángela" }));
  assert.equal(m.name, "Rosángela");
});

// A.4 — fixed-point rounds half away from zero.
test("A.4 toFixed rounds half away from zero", () => {
  assert.equal(toFixed(120.755), 12076);
  assert.equal(toFixed(-120.755), -12076);
  assert.equal(fromFixed(-12075), -120.75);
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}`);
