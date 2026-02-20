#!/usr/bin/env node

/**
 * Minimal static file server for the demo page.
 * Serves tests/demo-page.html and injects the terminal WS port.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DEMO_PORT || "3224", 10);
const WS_PORT = parseInt(process.env.JABTERM_WS_PORT || "3223", 10);

const demoHtml = fs.readFileSync(
  path.join(__dirname, "demo-page.html"),
  "utf-8",
);

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const html = demoHtml.replace(/__JABTERM_WS_PORT__/g, String(WS_PORT));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Serve xterm CSS from node_modules
  if (req.url === "/xterm.css") {
    const cssPath = path.resolve(
      __dirname,
      "../node_modules/@xterm/xterm/css/xterm.css",
    );
    if (fs.existsSync(cssPath)) {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(fs.readFileSync(cssPath));
      return;
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[demo] Serving on http://127.0.0.1:${PORT}`);
});
