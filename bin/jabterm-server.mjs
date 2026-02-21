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
import { parseCliArgs, resolveCliPort } from "../dist/server/cli.js";

const args = parseCliArgs(process.argv.slice(2));
const port = resolveCliPort(args, process.env);

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
