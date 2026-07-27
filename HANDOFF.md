# Team 9 — Handoff (CTF-GRID, v3 binary)

**From:** Cruz · **For:** Rosángela (+ her Claude Code) · **Date:** 2026-07-25

Read this first, then `CLAUDE.md` (context for Claude Code), then the protocol in
`protocolo/`. This package is self-contained — everything you need is in this folder.

---

## 1. TL;DR — where we are

We (team 9, JS/Phaser) are building the CTF game on the **v3 binary protocol**.
The **communication layer is built and confirmed working end to end**. The actual
game visuals and some networking niceties are not done yet.

| Area | Status |
|---|---|
| Binary codec (encode/decode all messages) | ✅ done, golden-byte tested (`npm test`) |
| Server + game loop (movement, flag, steal, victory) | ✅ works (minimal, not polished) |
| Bridge (browser ↔ TCP server, binary) | ✅ works |
| Cross-machine over Tailscale (Mac server ↔ Windows VM client) | ✅ confirmed |
| **Host / spectator view** (§4 — server shows the game, host doesn't play) | ✅ done — `web/spectator.html` ← server WS :5200 |
| **Phaser rendered client** (map, circle, flag, players, keyboard, smoothing) | ✅ **done (Phase 1)** — `web/net.js` + `web/game.js` |
| Lobby / host-controlled start / countdown / winner | ✅ **done (Phase 2)** — host presses ENTER; dead peers via TCP keepalive (app idle-timeout OFF: it kicked other teams' silent-but-valid clients) |
| **UDP server discovery** (§19) | ✅ **done (Phase 3)** — bridge broadcasts, UI lists servers; manual host/port fallback |
| Cross-team interop (vs another group's server) | ❌ not tested yet |
| Client-side prediction (§31, optional) | ❌ not started |

**Bottom line:** the hard, risky part — binary comms across a real network — is
proven. What's left is mostly the *client* (make it look like a game) plus
discovery and interop testing.

---

## 2. The protocol we're using — IMPORTANT status

- We're implementing **`protocolo/PRFC-VERSION-3.md`** (binary, big-endian,
  continuous plane, 4-direction movement).
- Our code also applies **`protocolo/PRFC-VERSION-3-enmiendas-parte1.md`** — gap
  fixes we proposed (framing-error → close, `str` length in bytes, fixed-point
  rounding, etc.). The codec already implements these.
- ⚠️ **v3 is still `Propuesto`, not ratified by the class.** The currently
  "Vigente" spec is v2 (JSON). The class still has to vote v3 in. So treat the
  binary choice as *our team's direction*, not a class-final decision. If the
  class stays on v2 JSON, the `demo/` folder (our older JSON walking skeleton)
  is the fallback.

---

## 3. What's in this folder

```
game/
  protocol.js        the binary codec — SINGLE SOURCE OF TRUTH for the wire format
  protocol.test.js   golden-byte + round-trip self-tests  ->  npm test
  server.js          authoritative server + 20 tps game loop (§30)
  bridge.js          dumb WS<->TCP binary pipe (browser can't do raw TCP)
  serve.js           tiny static server for the web UI
  bot.js             headless test client (raw TCP) — plays toward the flag
  web/index.html     the player UI (plain HTML, imports protocol.js)
  CLAUDE.md          context for Claude Code
  HANDOFF.md         this file
  protocolo/         the v3 spec + our proposed amendments
```

The codec (`protocol.js`) is deliberately environment-agnostic — the same file
runs in the Node server, the Node bridge, and the browser. **If you change the
wire format, change it there and nowhere else, and re-run `npm test`.**

---

## 4. How to run it

```bash
npm install                          # once (pulls in `ws`)
node server.js 5100                  # authority — press ENTER to start (auto-start: node server.js 5100 1)
node bridge.js 8080                  # bridge: WS 8080, UDP discovery 5001
npm run web                          # web UI at http://localhost:5173
```

In the browser at `http://localhost:5173`:
1. Bridge `ws://localhost:8080` → **Connect bridge**.
2. **Find servers** (UDP discovery) and pick one from the dropdown — or type Host
   `127.0.0.1` / Port `5100` manually — set a Name → **Join**.
3. **Press ENTER in the server terminal** to start the match.

Second player: another bridge on `8081` + a second tab, or `node bot.js Bot 127.0.0.1 5100`.

**Host view (§4):** on the machine running the server, open
`http://localhost:5173/spectator.html` → **Watch** (connects to `ws://localhost:5200`).
The host watches the match read-only, without being a player.

- ⚠️ **Use port 5100, not 5000** — 5000 is taken by macOS AirPlay Receiver.
- **Discovery** uses UDP broadcast (port 5001). It works on a real LAN and over
  **Radmin VPN** (which carries broadcast). It does **not** cross Tailscale — over
  Tailscale, type the host's Tailscale IP manually. The bridge is generic now: it
  is NOT tied to a server at launch; the browser chooses the server (discovered or
  manual).
- **Cross-machine:** on each machine run `node bridge.js 8080` + `npm run web`;
  the browser discovers or enters the server host's IP. Allow the firewall prompt
  on the server side.

**Verify the codec is correct:** `npm test` — all checks must pass, especially the
golden bytes `11 03 00 07 01` (an INPUT from P07 moving up). If that byte string
is wrong, we don't interoperate with anyone.

---

## 5. What to pick up next (suggested order)

Phase 1 (Phaser rendering + keyboard input + snapshot interpolation) is **done** —
see `web/net.js` (wire + interpolation) and `web/game.js` (render + input).
Remaining:

1. **Cross-team interop**: point our client at another group's server and share
   golden bytes to debug. This is what the grade rides on.
2. **Client-side prediction** (optional, §31): move your own player locally on
   keypress and reconcile when `GAME_STATE` arrives, for a zero-lag feel.

Rendering notes for `game.js`: coords arrive fixed-point (×100) → use
`fromFixed()` (done in `net.js`); origin is center; **y grows down**; the
world→screen transform lives in `game.js` (`tx`/`ty`/`s`).

---

## 6. Key decisions & why (so we don't relitigate)

- **Binary over JSON**: the class discussion wants deeper networking; binary is
  ~10× smaller and more impressive. Cost: harder to debug, higher interop risk.
  We accept it *if* the class commits (see the open question below).
- **Fixed-point integers, not floats** (coords are `world × 100` as i32): avoids
  IEEE-754 float disagreements across 6 languages — the worst binary interop trap.
- **Big-endian everywhere**, `u16` length-prefix framing on TCP. The #1 interop
  bug is endianness — check it first if something won't connect.
- **Server is sole authority**; clients send only `INPUT` (direction) and
  `INTERACT`. Never positions.

---

## 7. Open questions to decide together

1. **Flag-day vs. negotiated encoding.** v3 as written is an incompatible cutover
   — every team must switch to binary at once. Safer alternative: keep v2 JSON as
   a baseline and negotiate binary as an opt-in upgrade in `JOIN`. Grade depends
   on *all* teams connecting, so this matters.
2. **Keep the auto game loop, or pure lobby?** The server currently auto-starts a
   match at N players. For pure comms testing we could keep it lobby-only.
3. **Get the enmiendas (Parte 1) ratified** by the class before byte-exact coding
   spreads.
