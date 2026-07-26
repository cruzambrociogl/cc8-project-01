# CLAUDE.md — CTF-GRID team 9 (v3 binary)

Context for Claude Code working in this folder. Read `HANDOFF.md` for the full
story and `protocolo/` for the spec.

## What this is

Team 9's implementation of a class-wide capture-the-flag game where 13 teams in 6
languages must interoperate over one wire protocol. Our stack: JavaScript /
Phaser (browser), so our client needs a Node **bridge** (browsers can't open raw
TCP/UDP). We are building on the **v3 binary protocol** (`protocolo/PRFC-VERSION-3.md`)
plus our proposed amendments (`protocolo/PRFC-VERSION-3-enmiendas-parte1.md`),
both already implemented in `protocol.js`.

Status: the communication layer works end to end (server ↔ bridge ↔ browser,
cross-machine). No game graphics yet. See `HANDOFF.md` §1 for the status table
and §5 for what to build next (Phaser rendering is the biggest piece).

## Architecture

- `protocol.js` — the binary codec. **The single source of truth for the wire
  format.** Environment-agnostic (Node + browser). Change the wire format ONLY
  here, then run `npm test`.
- `server.js` — authoritative server, 20 tps loop (§30). Clients never send
  positions; the server computes everything.
- `bridge.js` — dumb WS↔TCP binary pipe. Never put game logic here.
- `web/index.html` — the player UI (imports `protocol.js`).
- `bot.js` — headless test client over raw TCP.

## Conventions that must not break interop

- **Big-endian** for all multi-byte integers; `u16` length-prefix framing on TCP.
- **Coordinates are fixed-point i32 = world × 100.** Use `toFixed()`/`fromFixed()`
  at the edges; never put floats on the wire. Internal math (distance/sqrt) may
  use floats — only the wire must be integer.
- **Origin is the center; y grows downward** (screen convention).
- Golden bytes: an `INPUT` from P07 moving up MUST serialize to `11 03 00 07 01`.
  `npm test` checks this — if it fails, we interoperate with no one.

## Commands

```bash
npm install                          # once
npm test                             # codec golden-byte / round-trip checks
node server.js 5100                  # server, press ENTER to start (5000 = macOS AirPlay)
node bridge.js 8080                  # bridge: WS 8080 + UDP discovery 5001 (browser picks server)
npm run web                          # UI at http://localhost:5173
node bot.js Bot 127.0.0.1 5100       # headless test player (raw TCP, no bridge)
```

## Notes

- v3 is still **Propuesto**, not ratified by the class (v2 JSON is Vigente). Don't
  assume the binary choice is final — see `HANDOFF.md` §7.
- The `../demo/` folder (if present) is the older JSON walking skeleton — fallback,
  not current.
