// scripts/serve.js — minimal static file server for the dashboard.
// Why: the dashboard uses fetch("./data.json"), which browsers block on the
// file:// protocol. This serves /public over http so it works. Zero deps.
//
//   node scripts/serve.js     ->  http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DIR = path.join(__dirname, "..", "public");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript",
  ".json": "application/json", ".css": "text/css",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(DIR)) { res.writeHead(403).end("Forbidden"); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Dashboard:  http://localhost:${PORT}`));
