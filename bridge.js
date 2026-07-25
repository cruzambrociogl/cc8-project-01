// PRFC-CC8-2026 v3.0 — BRIDGE (binary)
//
// Same dumb-pipe role as the JSON demo bridge, now for binary. It only does
// framing translation — zero game logic. If it ever decodes a message, it's broken.
//
//   node bridge.js [server-host] [server-port] [ws-port]
//       server-host  default 127.0.0.1   (host's Tailscale IP from a VM)
//       server-port  default 5100
//       ws-port      default 8080        (one per browser player: 8080, 8081, ...)
//
// TCP side: length-prefixed binary (§23.2). The bridge OWNS that framing.
// WS  side: one WebSocket BINARY frame = one complete message body, so the
//           browser never touches length prefixes — same deal as newlines before.

import net from "node:net";
import { WebSocketServer } from "ws";
import { frame, StreamFramer } from "./protocol.js";

const HOST = process.argv[2] ?? "127.0.0.1";
const TCP_PORT = Number(process.argv[3] ?? 5100);
const WS_PORT = Number(process.argv[4] ?? 8080);

new WebSocketServer({ port: WS_PORT }).on("connection", (ws) => {
  const tcp = net.createConnection({ host: HOST, port: TCP_PORT }, () => tcp.setNoDelay(true));
  const framer = new StreamFramer();

  // TCP -> WS: de-frame the stream, hand the browser one whole message body per frame.
  tcp.on("data", (chunk) => {
    for (const body of framer.push(new Uint8Array(chunk))) {
      if (ws.readyState === ws.OPEN) ws.send(body); // Uint8Array -> binary WS frame
    }
  });

  // WS -> TCP: the browser sends one message body; we prepend the u16 length.
  ws.on("message", (data) => {
    const body = new Uint8Array(data); // Buffer or ArrayBuffer -> bytes
    tcp.write(frame(body));
  });

  const close = () => { tcp.destroy(); try { ws.close(); } catch {} };
  tcp.on("close", close); tcp.on("error", close);
  ws.on("close", close);  ws.on("error", close);
});

console.log(`binary bridge: ws://localhost:${WS_PORT}  ->  tcp://${HOST}:${TCP_PORT}`);
