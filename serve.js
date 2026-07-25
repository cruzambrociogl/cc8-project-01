// Tiny static file server for the web UI.
//   node serve.js  ->  http://localhost:5173
// Serves the whole game/ dir so the page (/web/index.html) can import the shared
// /protocol.js codec directly, with no duplication.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5173;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

http.createServer((req, res) => {
  let p = (req.url === "/" ? "/web/index.html" : req.url).split("?")[0];
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end("forbidden"); }
  fs.readFile(file, (e, d) => {
    if (e) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(d);
  });
}).listen(PORT, () => console.log(`web ui: http://localhost:${PORT}`));
