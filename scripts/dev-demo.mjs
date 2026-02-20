#!/usr/bin/env node

import { spawn } from "child_process";

const WS_PORT = parseInt(process.env.JABTERM_PORT || "3223", 10);
const DEMO_PORT = parseInt(process.env.DEMO_PORT || String(WS_PORT + 1), 10);

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  return child;
}

async function main() {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  const build = run(pnpmCmd, ["build"]);
  const buildExitCode = await new Promise((resolve) => {
    build.on("exit", (code) => resolve(code ?? 1));
  });
  if (buildExitCode !== 0) process.exit(buildExitCode);

  const server = run(process.execPath, ["bin/jabterm-server.mjs", "--port", String(WS_PORT)], {
    env: {
      ...process.env,
      JABTERM_STRICT_PORT: process.env.JABTERM_STRICT_PORT ?? "1",
      JABTERM_PORT: String(WS_PORT),
    },
  });

  const demo = run(process.execPath, ["tests/serve-demo.mjs"], {
    env: {
      ...process.env,
      DEMO_PORT: String(DEMO_PORT),
      JABTERM_WS_PORT: String(WS_PORT),
    },
  });

  const shutdown = (signal) => {
    process.stderr.write(`\n[dev:demo] received ${signal}, shutting down...\n`);
    try {
      server.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      demo.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const exitCode = await new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      resolve(code ?? 0);
    };
    server.on("exit", finish);
    demo.on("exit", finish);
  });

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`[dev:demo] fatal: ${err?.stack || err}\n`);
  process.exit(1);
});

