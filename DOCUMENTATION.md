# CTF-GRID — Technical Documentation (Team 9)

Capture-the-flag game implemented on the **PRFC-CC8-2026 v3.0 binary protocol**, so
that all course teams (13 teams, 6 languages) can interoperate over one wire format.
Team 9's stack is **JavaScript** with a **Phaser** browser renderer, plus a small
**Node.js** bridge and server.

- Full protocol spec: [`protocolo/PRFC-VERSION-3.md`](protocolo/PRFC-VERSION-3.md)
- Our proposed clarifications: [`protocolo/PRFC-VERSION-3-enmiendas-parte1.md`](protocolo/PRFC-VERSION-3-enmiendas-parte1.md)
- Quick start: [`README.md`](README.md) · Team handoff: [`HANDOFF.md`](HANDOFF.md)

---

## 1. Technologies

| Area | Choice | Why |
|---|---|---|
| Language | JavaScript (ES modules) | Team stack; same codec runs in Node and the browser |
| Runtime | Node.js (server, bridge, static file server) | Native TCP (`node:net`) and UDP (`node:dgram`) |
| Renderer | Phaser 3 (vendored, `web/vendor/phaser.min.js`) | 2D canvas/WebGL game rendering in the browser |
| Browser↔OS | WebSocket (`ws` npm package) | Browsers cannot open raw TCP/UDP; the bridge translates |
| Wire format | Custom **binary**, big-endian, length-prefixed | v3 protocol (compact, ~10× smaller than JSON) |
| Build step | **None** | Plain ES modules served statically; `npm install` only pulls `ws` |

The only npm dependency is **`ws`** (for the server's spectator socket and the
bridge). Phaser is vendored as a file (not an npm dep) so the game runs offline on
a LAN/VPN.

---

## 2. Architecture

Single authoritative server per match; clients only send *intent* (movement
direction + interact), never positions. The server owns all state and validates
everything.

```
                      ┌─────────────────────────────┐
                      │          SERVER             │  owns game state, 20 ticks/s
                      │  TCP :5000  (gameplay)      │  authoritative, no player entity
                      │  UDP :5001  (discovery)     │
                      │  WS  :5200  (host view)     │
                      └───┬───────────┬─────────────┘
       raw TCP + UDP      │           │  WebSocket (localhost)
   (native-language ──────┘           └──────── [ host view / spectator.html ]
    clients connect                              read-only overhead view + Start/Reset
    directly)                │
                             │  our browser client cannot do raw TCP/UDP, so:
                   ┌─────────┴──────────┐
                   │   BRIDGE (Node)    │  WS :8080  ⇄  TCP :5000 / UDP :5001
                   │  dumb byte pipe +  │
                   │  UDP discovery     │
                   └─────────┬──────────┘
                             │  WebSocket (binary frames)
                   ┌─────────┴──────────┐
                   │  BROWSER CLIENT    │  index.html + Phaser (web/game.js)
                   │  (the player)      │  keyboard → INPUT/INTERACT, renders GAME_STATE
                   └────────────────────┘
```

Any team's client must be able to play on any team's server. A native-language
client (Rust, Go, Java, C#, Python) connects **directly** by TCP; our browser
client goes through the bridge. From the server's point of view they are identical.

---

## 3. Project structure

| File | Role |
|---|---|
| `protocol.js` | **The binary codec** — single source of truth for the wire format. `encode`/`decode` for every message, `frame`/`StreamFramer` for TCP length-prefix framing, fixed-point helpers, enums. Runs in Node *and* the browser. |
| `protocol.test.js` | Conformance self-tests — golden bytes + round-trip for every message (`npm test`). |
| `server.js` | Authoritative server: TCP gameplay, UDP discovery, 20 tps game loop, host-view WS, host-controlled start. |
| `bridge.js` | WS↔TCP/UDP gateway for the browser client. Zero game logic. |
| `serve.js` | Tiny static HTTP server for the web UI (port 5173). |
| `bot.js` | Headless test client (raw TCP) that joins and plays toward the flag. |
| `web/index.html` | Player UI: connect, discover/pick a server, join; hosts the Phaser canvas. |
| `web/spectator.html` | Host view: read-only overhead render + Start / New-match controls. |
| `web/net.js` | Browser networking: WebSocket + codec + world state + snapshot interpolation. |
| `web/game.js` | Phaser scene: renders map, circle, flag, players; reads keyboard. |
| `web/vendor/phaser.min.js` | Vendored Phaser 3 (offline-capable). |
| `protocolo/` | The v3 spec and our proposed amendments. |

---

## 4. The protocol (summary)

Full details in [`protocolo/PRFC-VERSION-3.md`](protocolo/PRFC-VERSION-3.md). Key points:

- **Binary, big-endian.** All multi-byte integers are network byte order.
- **Framing (TCP):** every message is preceded by a `u16` big-endian length, then
  that many body bytes. The body starts with `u8 type` + `u8 version(=3)`.
  (UDP datagrams carry one message, no length prefix.)
- **Fixed-point coordinates:** world units are sent as `i32` of `value × 100`
  (e.g. `-120.75` → `-12075`). This avoids cross-language float disagreements —
  no floating-point numbers ever cross the wire.
- **Tolerant reader:** unknown-but-well-framed message types are skipped; a genuine
  framing/decode error closes the connection.

### Message set

| Code | Message | Dir | Purpose |
|---|---|---|---|
| `0x01` | DISCOVER_REQUEST | C→bcast (UDP) | "any servers out there?" |
| `0x02` | DISCOVER_RESPONSE | S→C (UDP) | server ad: name, TCP port, players |
| `0x10` | JOIN | C→S | request to join (`name`) |
| `0x11` | INPUT | C→S | active direction (UP/DOWN/LEFT/RIGHT/NONE) |
| `0x12` | INTERACT | C→S | press the interact key (grab/steal) |
| `0x13` | LEAVE | C→S | leave voluntarily |
| `0x20` | JOIN_ACCEPTED | S→C | assigned `playerId` |
| `0x21` | JOIN_REJECTED | S→C | reason (full / started / …) |
| `0x22` | LOBBY_STATE | S→C | player list while waiting |
| `0x23` | GAME_COUNTDOWN | S→C | seconds remaining |
| `0x24` | GAME_STARTED | S→C | full config (map, circle, speed…) + players |
| `0x25` | GAME_STATE | S→C | authoritative snapshot, every tick |
| `0x26` | FLAG_PICKED_UP | S→C | someone grabbed the flag |
| `0x27` | FLAG_STOLEN | S→C | flag changed carrier |
| `0x28` | PLAYER_DISCONNECTED | S→C | a player left |
| `0x29` | GAME_OVER | S→C | winner |
| `0x2A` | ERROR | S→C | non-fatal error code |

Golden byte check: an `INPUT` from player `7` moving UP serializes to the body
`11 03 00 07 01`, framed on TCP as `00 05 11 03 00 07 01`. `npm test` verifies this.

---

## 5. Game mechanics

- **Map:** a **continuous** 2000×2000 plane (not a grid). Origin `(0,0)` is the
  center; **x grows right, y grows down** (screen convention). Players are clamped
  to the map bounds (±1000).
- **Central circle:** radius 500, centered on the origin. The single flag sits at
  the center.
- **Movement:** 4 directions (UP/DOWN/LEFT/RIGHT) or NONE (stop). The client sends
  its *active direction* only when it changes; the server advances each player one
  step per tick (`playerSpeed × tickInterval`, default 220 u/s at 20 tps = 11 u/tick).
  Players do not collide with each other.
- **Grabbing the flag:** press interact within `interactionRadius` (60) of the flag
  while it's on the ground → you carry it (`FLAG_PICKED_UP`).
- **Stealing:** press interact within range of the current carrier → the flag
  instantly changes hands (`FLAG_STOLEN`). **No immunity, no cooldown** — it can
  change hands every tick. Simultaneous steals in one tick resolve by lowest
  `playerId`.
- **Winning:** carry the flag **completely outside** the circle
  (`distance(player, origin) − playerRadius > circleRadius`). First to do so wins;
  the server sends the final `GAME_STATE` then `GAME_OVER`.
- **Disconnect:** the player is removed; if they carried the flag it drops where
  they were and can be picked up again.
- **Server tick loop (20 Hz):** drain inputs → move & clamp → resolve interacts by
  ascending `playerId` → update flag → check victory → increment tick → send events
  then `GAME_STATE`.

---

## 6. Client–server connectivity

### Ports

| Port | Transport | Used for |
|---|---|---|
| `5000` | TCP | gameplay (the match) |
| `5001` | UDP | server discovery (broadcast) |
| `5200` | WebSocket (localhost) | host view / spectator + host controls |
| `8080` | WebSocket | bridge ⇄ browser client |
| `5173` | HTTP | static web UI |

> On macOS, port **5000 is used by AirPlay Receiver**, so we run the server on
> **5100** in practice. All parts are configurable.

### Lifecycle

1. **Discovery (optional).** The client (via its bridge) UDP-broadcasts
   `DISCOVER_REQUEST` on 5001. Servers in the *waiting* state reply
   `DISCOVER_RESPONSE` (their name, TCP port, player count). The client lists them;
   manual IP entry is always available as a fallback.
2. **Join.** Client opens TCP to the server and sends `JOIN`; server replies
   `JOIN_ACCEPTED` (+ `playerId`) or `JOIN_REJECTED`.
3. **Lobby.** Server broadcasts `LOBBY_STATE` as players come and go.
4. **Start.** The **host** (server operator) starts the match — by pressing ENTER
   in the server terminal, or the **Start match** button in the host view. Server
   sends `GAME_COUNTDOWN` × N, then `GAME_STARTED` (full config).
5. **Play.** Client sends `INPUT`/`INTERACT`; server broadcasts `GAME_STATE` every
   tick plus event messages.
6. **End.** `GAME_OVER`. The host can reset to a fresh lobby (**New match**).

### The bridge (why it exists)

Browsers cannot open raw TCP or UDP sockets. The bridge is a **dumb byte pipe** that
speaks WebSocket to the page and raw TCP/UDP to the game network:
- **Text** WS frames = control (`discover`, `connect`) — bridge-only, never reach
  the server.
- **Binary** WS frames = game messages — relayed verbatim to/from the server's TCP
  (the bridge owns the u16 framing so the browser handles whole messages).
- The bridge performs the UDP broadcast for discovery on the browser's behalf.

Native-language teams need no bridge — they open the TCP/UDP sockets directly.

### Robustness / interop posture

- **Dead connections** are detected with **TCP keepalive** (`setKeepAlive`), not an
  app-level idle timer — so a valid but silent client (waiting in the lobby, or
  standing still) is never kicked. (An app idle-timeout is available but disabled by
  default; enabling it would break interop with clients that don't send a keepalive.)
- **Tolerant reader:** we never reject a `JOIN` over the name (accept any, clamp for
  display), and we skip unknown message types. Principle: *strict in what we send,
  lenient in what we accept.*

---

## 7. Usage

Requires **Node.js**. From the `game/` folder:

```bash
npm install          # pulls in `ws`
npm test             # verify the codec (golden-byte + round-trip checks)
```

### Run a server (host)

```bash
node server.js 5100 "My Server"      # port 5100, name shown in discovery
# then press ENTER (or use the host view) to start once players have joined
```

### Host view (watch + control the match)

```bash
npm run web                          # serves the UI on http://localhost:5173
```
Open `http://localhost:5173/spectator.html` → **Watch** → **▶ Start match** /
**↻ New match**. The host does not play (per protocol §4).

### Play as a client

```bash
node bridge.js 8080                  # WS 8080 + UDP discovery 5001
npm run web                          # http://localhost:5173
```
Open `http://localhost:5173`:
1. Bridge `ws://localhost:8080` → **Connect bridge**
2. **Find servers** (pick one) or type Host/Port manually → set a Name → **Join**
3. Move with **arrows / WASD**; grab or steal with **Space / E**; carry the flag
   out of the circle to win.

### Cross-machine (LAN / Radmin VPN / Tailscale)

- Run the server on one machine; each player runs their own `bridge.js` + web UI and
  either **discovers** the server (works on a LAN and over **Radmin VPN**, which
  carries broadcast) or **types the host's IP** (required over Tailscale, which does
  not carry broadcast).
- Allow the OS firewall prompt for `node` on the server machine.

### Headless test bot

```bash
node bot.js BotName 127.0.0.1 5100   # joins and plays toward the flag (raw TCP)
```

---

## 8. Status & limitations

- **Done:** binary codec (tested), authoritative server + full game loop, browser
  client with Phaser rendering + snapshot interpolation, WS/UDP bridge, server
  discovery, lobby + host-controlled start + replay, host/spectator view, and
  base-v3 interop hardening.
- **Not implemented (optional):** client-side prediction (§31), visual polish beyond
  the functional renderer, reconnection (explicitly out of scope in the spec).
- **Interop caveat:** the whole class must be on protocol v3 for cross-team play; v3
  is a proposal (v2 was the prior spec). Our amendments (`protocolo/…enmiendas…`) are
  clarifications, not wire changes — we interoperate with base-v3-only teams.
