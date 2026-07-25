// Tiny static file server for the web UI.
//   node serve.js  ->  http://localhost:5173
// Web root is game/web/. The shared codec /protocol.js is aliased to the root
// game/protocol.js so the browser, Node server, and bridge all use ONE codec file.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEBROOT = path.join(ROOT, "web");
const PORT = 5173;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

http.createServer((req, res) => {
  let p = (req.url === "/" ? "/index.html" : req.url).split("?")[0];
  // shared codec lives at the game root, not under web/
  const file = p === "/protocol.js" ? path.join(ROOT, "protocol.js") : path.join(WEBROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end("forbidden"); }
  fs.readFile(file, (e, d) => {
    if (e) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(d);
  });
}).listen(PORT, () => console.log(`web ui: http://localhost:${PORT}`));
