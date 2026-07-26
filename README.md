# CTF-GRID — v3 binary walking skeleton (team 9)

Server + bridge + web UI speaking the **v3 binary protocol**. The communication
layer is built and confirmed working; game graphics are not done yet.

👉 **New here? Read [HANDOFF.md](HANDOFF.md) first**, then [CLAUDE.md](CLAUDE.md).
The protocol is in [protocolo/](protocolo/).

## Quick run

```bash
npm install                          # once (pulls in `ws`)
node server.js 5100                  # authority — press ENTER to start (auto: node server.js 5100 1)
node bridge.js 8080                  # bridge: WS 8080, UDP discovery 5001
npm run web                          # UI at http://localhost:5173
npm test                             # verify the codec (golden bytes)
```

In the browser (`http://localhost:5173`): Bridge `ws://localhost:8080` → **Connect
bridge** → **Find servers** (or type Host/Port) → set Name → **Join** → **press
ENTER in the server terminal** to start.

**Host view (§4):** on the server machine, open `http://localhost:5173/spectator.html`
→ **Watch** (`ws://localhost:5200`). The host watches the match without playing.

- ⚠️ Use port **5100** (5000 = macOS AirPlay). Discovery uses UDP broadcast (5001):
  works on a LAN and over **Radmin VPN**; over Tailscale, enter the IP manually.
- Second player: another bridge on `8081` + a second tab, or `node bot.js Bot 127.0.0.1 5100`.

⚠️ Use port **5100** (5000 collides with macOS AirPlay). Cross-machine: point the
bridge at the server's IP, e.g. `node bridge.js <server-ip> 5100 8080`.

## Files

| File | Role |
|---|---|
| `protocol.js` | binary codec — single source of truth for the wire format |
| `protocol.test.js` | golden-byte / round-trip self-tests (`npm test`) |
| `server.js` | authoritative server + 20 tps loop |
| `bridge.js` | dumb WS↔TCP binary pipe |
| `serve.js` | static server for the web UI |
| `web/index.html` | player UI (labels + live player panel, no graphics yet) |
| `bot.js` | headless test client (raw TCP) |
| `protocolo/` | v3 spec + our proposed amendments |
