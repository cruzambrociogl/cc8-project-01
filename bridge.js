// PRFC-CC8-2026 v3.0 — BRIDGE (binary + UDP discovery)
//
//   node bridge.js [ws-port] [discovery-port] [broadcast-addr]
//       ws-port          default 8080  (one per browser player: 8080, 8081, ...)
//       discovery-port   default 5001
//       broadcast-addr   default 255.255.255.255  (Radmin VPN carries this)
//
// The browser can do neither raw TCP nor UDP/broadcast, so this bridge does both
// on its behalf. Two channels over the one WebSocket:
//   • TEXT frames  = control (browser <-> bridge only): discover / connect.
//   • BINARY frames = game wire (relayed verbatim to/from the chosen TCP server).
// It never interprets game messages — for TCP it only adds/strips the u16 frame.

import net from "node:net";
import dgram from "node:dgram";
import { WebSocketServer } from "ws";
import { encode, decode, frame, StreamFramer } from "./protocol.js";

const WS_PORT = Number(process.argv[2] ?? 8080);
const DISCOVERY_PORT = Number(process.argv[3] ?? 5001);
const BROADCAST_ADDR = process.argv[4] ?? "255.255.255.255";
const DISCOVER_WINDOW_MS = 800;

const ctl = (ws, obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }; // text frame

// UDP broadcast a DISCOVER_REQUEST and collect DISCOVER_RESPONSEs for a short window.
function discover(ws) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const found = new Map(); // "host:port" -> server info
  sock.on("message", (buf, rinfo) => {
    let m; try { m = decode(new Uint8Array(buf)); } catch { return; }
    if (m.type !== "DISCOVER_RESPONSE") return;
    found.set(`${rinfo.address}:${m.tcpPort}`, {
      host: rinfo.address, port: m.tcpPort, name: m.serverName,
      state: m.state, players: m.playerCount, max: m.maximumPlayers,
    });
  });
  sock.on("error", () => { ctl(ws, { t: "servers", list: [] }); try { sock.close(); } catch {} });
  sock.bind(() => {
    try { sock.setBroadcast(true); } catch {}
    const req = Buffer.from(encode({ type: "DISCOVER_REQUEST" }));  // 2 bytes, no length prefix (§23.3)
    sock.send(req, DISCOVERY_PORT, BROADCAST_ADDR);
    sock.send(req, DISCOVERY_PORT, "127.0.0.1");   // also find a server on this machine
    setTimeout(() => {
      ctl(ws, { t: "servers", list: [...found.values()] });
      try { sock.close(); } catch {}
    }, DISCOVER_WINDOW_MS);
  });
}

// Open the game TCP connection and wire the binary relay in both directions.
function connectTcp(ws, session, host, port) {
  if (session.tcp) { try { session.tcp.destroy(); } catch {} }
  const framer = new StreamFramer();
  const tcp = net.createConnection({ host, port }, () => { tcp.setNoDelay(true); ctl(ws, { t: "connected", host, port }); });
  session.tcp = tcp;
  tcp.on("data", (chunk) => { for (const body of framer.push(new Uint8Array(chunk))) if (ws.readyState === ws.OPEN) ws.send(body); }); // -> binary WS frame
  tcp.on("error", (e) => ctl(ws, { t: "connect_error", error: e.message }));
  tcp.on("close", () => { session.tcp = null; ctl(ws, { t: "disconnected" }); });
}

new WebSocketServer({ port: WS_PORT }).on("connection", (ws) => {
  const session = { tcp: null };

  ws.on("message", (data, isBinary) => {
    if (isBinary) {                                     // game wire -> TCP (add u16 frame)
      if (session.tcp) session.tcp.write(frame(new Uint8Array(data)));
      return;
    }
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; } // control
    if (msg.t === "discover") discover(ws);
    else if (msg.t === "connect") connectTcp(ws, session, msg.host, Number(msg.port));
  });

  ws.on("close", () => { if (session.tcp) session.tcp.destroy(); });
  ws.on("error", () => { if (session.tcp) session.tcp.destroy(); });
});

console.log(`bridge: ws://localhost:${WS_PORT}  ·  UDP discovery on ${DISCOVERY_PORT} (broadcast ${BROADCAST_ADDR})`);
