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
const REPO_ROOT = path.resolve(__dirname, "..");

const demoHtml = fs.readFileSync(
  path.join(__dirname, "demo-page.html"),
  "utf-8",
);

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs"))
    return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    const html = demoHtml.replace(/__JABTERM_WS_PORT__/g, String(WS_PORT));
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // Serve build output (used by the React demo page)
  if (req.url?.startsWith("/dist/")) {
    const fsPath = path.resolve(REPO_ROOT, req.url.slice(1));
    if (!fsPath.startsWith(REPO_ROOT + path.sep)) {
      res.writeHead(400);
      res.end("Bad path");
      return;
    }
    if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
      res.writeHead(200, { "Content-Type": contentTypeFor(fsPath) });
      res.end(fs.readFileSync(fsPath));
      return;
    }
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
