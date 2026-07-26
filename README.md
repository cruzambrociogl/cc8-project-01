# CTF-GRID — v3 binary walking skeleton (team 9)

Server + bridge + web UI speaking the **v3 binary protocol**. The communication
layer is built and confirmed working; game graphics are not done yet.

👉 **New here? Read [HANDOFF.md](HANDOFF.md) first**, then [CLAUDE.md](CLAUDE.md).
The protocol is in [protocolo/](protocolo/).

## Quick run

```bash
npm install                          # once (pulls in `ws`)
node server.js 5100                  # authority — press ENTER to start the match
node bridge.js 127.0.0.1 5100 8080   # bridge for a browser player
npm run web                          # UI at http://localhost:5173
npm test                             # verify the codec (golden bytes)
```

Open `http://localhost:5173`, bridge `ws://localhost:8080`, **Connect & join**,
then **press ENTER in the server terminal** to start. (`node server.js 5100 1`
auto-starts at 1 player for unattended testing.)
Second player: another bridge on `8081` + a second tab, or `node bot.js Bot 127.0.0.1 5100`.

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
