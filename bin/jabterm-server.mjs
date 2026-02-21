#!/usr/bin/env node

/**
 * CLI entrypoint for jabterm/server.
 *
 * Usage:
 *   npx jabterm-server
 *   npx jabterm-server --port 3223
 *   npx jabterm-server --port 3223 --shell /bin/bash --cwd /tmp --strict-port
 */

import { createTerminalServer } from "../dist/server/index.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      args.port = parseInt(argv[++i], 10);
    } else if (arg.startsWith("--port=")) {
      args.port = parseInt(arg.slice(7), 10);
    } else if (arg === "--shell" && argv[i + 1]) {
      args.shell = argv[++i];
    } else if (arg.startsWith("--shell=")) {
      args.shell = arg.slice(8);
    } else if (arg === "--cwd" && argv[i + 1]) {
      args.cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      args.cwd = arg.slice(6);
    } else if (arg === "--host" && argv[i + 1]) {
      args.host = argv[++i];
    } else if (arg.startsWith("--host=")) {
      args.host = arg.slice(7);
    } else if (arg === "--strict-port") {
      args.strictPort = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
  jabterm-server - JabTerm WebSocket terminal server

  Usage:
    jabterm-server [options]

  Options:
    --port <number>     Port to listen on (default: 3223, or JABTERM_PORT env)
    --host <string>     Host to bind to (default: 127.0.0.1)
    --shell <path>      Shell to spawn (default: uses $SHELL when available; otherwise bash/sh on Linux and zsh/bash/sh on macOS; powershell.exe on Windows)
    --cwd <path>        Working directory for new terminals (default: $HOME)
    --strict-port       Fail if port is already in use
    -h, --help          Show this help
`);
      process.exit(0);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const port = args.port ?? parseInt(process.env.JABTERM_PORT || "3223", 10);

const server = await createTerminalServer({
  port,
  host: args.host,
  shell: args.shell,
  cwd: args.cwd,
  strictPort: args.strictPort ?? process.env.JABTERM_STRICT_PORT === "1",
});

function shutdown(signal) {
  console.log(`\n[jabterm] Received ${signal}`);
  server.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
