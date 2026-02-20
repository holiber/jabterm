import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import os from "os";
import {
  assertPortFree,
  ensureNodePtySpawnHelperExecutable,
  resolveDefaultShell,
  safeLocale,
} from "./utils.js";

export interface TerminalServerOptions {
  /** Port to listen on. Default: 3223 */
  port?: number;
  /** Shell to spawn. Default: $SHELL when available; otherwise bash/sh on Linux and zsh/bash/sh on macOS (powershell.exe on Windows). */
  shell?: string;
  /** Working directory for new terminals. Default: $HOME or cwd */
  cwd?: string;
  /** If true, fail immediately when port is busy instead of silently skipping. */
  strictPort?: boolean;
  /** Host to bind to. Default: 127.0.0.1 */
  host?: string;
}

export interface TerminalServer {
  wss: WebSocketServer;
  port: number;
  close(): Promise<void>;
}

export async function createTerminalServer(
  opts?: TerminalServerOptions,
): Promise<TerminalServer> {
  const port = opts?.port ?? 3223;
  const host = opts?.host ?? "127.0.0.1";
  const shell = resolveDefaultShell(opts?.shell);
  const cwd = opts?.cwd ?? process.env.HOME ?? process.cwd();
  const strictPort = opts?.strictPort ?? false;

  ensureNodePtySpawnHelperExecutable();

  if (strictPort) {
    await assertPortFree(port);
  }

  const wss = new WebSocketServer({ port, host });
  const ptys = new Set<pty.IPty>();

  let shuttingDown = false;

  wss.on("connection", (ws: WebSocket) => {
    console.log("[jabterm] Client connected");

    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: safeLocale(),
    };

    try {
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env,
      });
      ptys.add(ptyProcess);
      let ptyExited = false;
      let wsClosed = false;

      ptyProcess.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      });

      const onWsMessage = (message: Buffer | string) => {
        if (wsClosed) return;
        if (ptyExited) {
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1011, "pty_exited");
            }
          } catch {
            /* ignore */
          }
          return;
        }

        let handled = false;

        try {
          const msgStr = message.toString();
          if (msgStr.startsWith("{")) {
            const control = JSON.parse(msgStr);
            if (control.type === "resize") {
              const cols = Math.max(control.cols || 80, 10);
              const rows = Math.max(control.rows || 24, 10);
              try {
                ptyProcess.resize(cols, rows);
              } catch (resizeErr) {
                console.error("[jabterm] Resize failed:", resizeErr);
              }
              handled = true;
            }
          }
        } catch {
          // Not a valid control message, treat as input
        }

        if (!handled) {
          try {
            ptyProcess.write(message.toString("utf-8"));
          } catch (err) {
            console.error("[jabterm] Error writing to PTY:", err);
          }
        }
      };

      ws.on("message", onWsMessage);

      ws.on("close", () => {
        wsClosed = true;
        console.log("[jabterm] Client disconnected");
        try {
          if (!ptyExited) ptyProcess.kill();
        } catch {
          /* ignore */
        }
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        ptyExited = true;
        console.log(
          `[jabterm] Process exited (code: ${exitCode}, signal: ${signal})`,
        );
        ptys.delete(ptyProcess);
        try {
          ws.off("message", onWsMessage);
        } catch {
          /* ignore */
        }
        if (!wsClosed && ws.readyState === WebSocket.OPEN) {
          const ok = exitCode === 0;
          ws.close(ok ? 1000 : 1011, ok ? "pty_exit" : "pty_error");
        }
      });
    } catch (err) {
      console.error("[jabterm] Failed to spawn pty:", err);
      try {
        ws.close(1011, "pty_spawn_failed");
      } catch {
        ws.close();
      }
    }
  });

  console.log(`[jabterm] Terminal server listening on ${host}:${port}`);

  async function close(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[jabterm] Shutting down");
    for (const p of ptys) {
      try {
        p.kill();
      } catch {
        /* ignore */
      }
    }
    return new Promise<void>((resolve) => {
      wss.close(() => resolve());
      setTimeout(() => resolve(), 2000).unref?.();
    });
  }

  return { wss, port, close };
}
