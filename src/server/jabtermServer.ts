import http, { type IncomingMessage } from "http";
import type { Duplex } from "stream";
import os from "os";
import * as pty from "node-pty";
import { WebSocketServer, WebSocket } from "ws";
import {
  assertPortFree,
  ensureNodePtySpawnHelperExecutable,
  resolveDefaultShell,
  safeLocale,
} from "./utils.js";

export type JabtermLogLevel = "debug" | "info" | "warn" | "error";

export interface JabtermLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface JabtermPtyOptions {
  shell?: string;
  shellArgs?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export interface OnCreatePtyContext {
  terminalId?: string;
  request: IncomingMessage;
}

export interface JabtermServerOptions {
  /** Port to listen on. Use 0 for an ephemeral port. Default: 3223 */
  port?: number;
  /** Host to bind to. Default: 127.0.0.1 */
  host?: string;
  /**
   * Base path for WebSocket upgrades. Supports per-terminal routing:
   * - `${path}` (no terminalId)
   * - `${path}/:terminalId`
   *
   * Default: "/"
   */
  path?: string;
  /** Default shell to spawn. */
  shell?: string;
  /** Default working directory for new terminals. */
  cwd?: string;
  /** Extra env vars to inject into spawned PTYs. */
  env?: NodeJS.ProcessEnv;
  /** If true, fail immediately when port is busy (ignored for port 0). */
  strictPort?: boolean;
  /**
   * Optional authentication hook. Return false to reject the upgrade request.
   * Useful for token/header validation.
   */
  authenticate?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /**
   * Optional WS origin allowlist.
   * - `string[]`: exact match against the `Origin` header
   * - function: custom policy
   *
   * If `Origin` is absent (e.g. node `ws` client), the connection is allowed.
   */
  allowedOrigins?:
  | string[]
  | ((origin: string | undefined, req: IncomingMessage) => boolean);
  /** Optional structured logger. */
  logger?: JabtermLogger;
  /**
   * Optional hook invoked on each connection to configure the PTY based on
   * terminalId and/or request metadata.
   */
  onCreatePty?: (
    ctx: OnCreatePtyContext,
  ) => JabtermPtyOptions | Promise<JabtermPtyOptions>;
}

export interface JabtermServerAddress {
  address: string;
  family: string;
  port: number;
}

export interface JabtermServer {
  /** Underlying WebSocketServer (noServer mode). */
  wss: WebSocketServer;
  /** Start listening (idempotent). */
  listen(): Promise<JabtermServerAddress>;
  /** Close server, WS clients, and PTYs (idempotent). */
  close(): Promise<void>;
  /** Get current address (only valid after listen()). */
  address(): JabtermServerAddress;
}

interface Session {
  terminalId?: string;
  ws: WebSocket;
  pty: pty.IPty;
  ptyExited: boolean;
  wsClosed: boolean;
  helloVersion?: number;
  onWsMessage: (message: Buffer | string) => void;
}

const JABTERM_PROTOCOL_VERSION = 1;

function defaultLogger(): JabtermLogger {
  return {
    debug: (message, meta) => console.debug(`[jabterm] ${message}`, meta ?? ""),
    info: (message, meta) => console.log(`[jabterm] ${message}`, meta ?? ""),
    warn: (message, meta) => console.warn(`[jabterm] ${message}`, meta ?? ""),
    error: (message, meta) => console.error(`[jabterm] ${message}`, meta ?? ""),
  };
}

function normalizeBasePath(p: string | undefined): string {
  const raw = (p ?? "/").trim() || "/";
  if (raw === "/") return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

function replyHttpError(socket: Duplex, status: number, reason: string) {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(reason)}\r\n` +
      "\r\n" +
      reason,
    );
  } catch {
    /* ignore */
  }
  try {
    socket.destroy();
  } catch {
    /* ignore */
  }
}

export function createJabtermServer(opts: JabtermServerOptions = {}): JabtermServer {
  ensureNodePtySpawnHelperExecutable();

  const basePath = normalizeBasePath(opts.path);
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 3223;
  const strictPort = opts.strictPort ?? false;
  const logger = opts.logger ?? defaultLogger();

  const httpServer = http.createServer((req, res) => {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
  });

  const terminalIdByReq = new WeakMap<IncomingMessage, string | undefined>();
  const wss = new WebSocketServer({ noServer: true });

  const ptys = new Set<pty.IPty>();
  const sessions = new Set<Session>();

  let listened = false;
  let closing = false;
  let closePromise: Promise<void> | null = null;

  async function authenticate(req: IncomingMessage): Promise<boolean> {
    if (!opts.authenticate) return true;
    try {
      const result = await opts.authenticate(req);
      return !!result;
    } catch (err) {
      logger.warn?.("authenticate hook threw; rejecting", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  function checkOrigin(req: IncomingMessage): boolean {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (!opts.allowedOrigins) return true;
    if (!origin) return true;
    if (Array.isArray(opts.allowedOrigins)) return opts.allowedOrigins.includes(origin);
    try {
      return !!opts.allowedOrigins(origin, req);
    } catch (err) {
      logger.warn?.("allowedOrigins hook threw; rejecting", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const hostHeader = typeof req.headers.host === "string" ? req.headers.host : "localhost";
    const url = new URL(req.url ?? "/", `http://${hostHeader}`);
    const pathname = url.pathname || "/";

    const matchesPath =
      basePath === "/" ? true : pathname === basePath || pathname.startsWith(basePath + "/");

    if (!matchesPath) return replyHttpError(socket, 404, "Not found");
    if (!checkOrigin(req)) return replyHttpError(socket, 403, "Forbidden");
    if (!(await authenticate(req))) return replyHttpError(socket, 401, "Unauthorized");

    let terminalId: string | undefined = undefined;
    if (basePath !== "/") {
      if (pathname !== basePath) {
        const rest = pathname.slice(basePath.length).replace(/^\/+/, "");
        terminalId = rest ? decodeURIComponent(rest) : undefined;
      }
    } else {
      // basePath="/" — treat "/:terminalId" as terminal routing, but keep legacy "/" working.
      const rest = pathname.replace(/^\/+/, "");
      terminalId = rest ? decodeURIComponent(rest) : undefined;
    }

    terminalIdByReq.set(req, terminalId);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  httpServer.on("upgrade", (req, socket, head) => {
    void handleUpgrade(req, socket, head);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const terminalId = terminalIdByReq.get(req);
    logger.info?.("ws_connected", { terminalId });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...opts.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: safeLocale(),
    };

    const defaultShell = resolveDefaultShell(opts.shell);
    const defaultCwd = opts.cwd ?? process.env.HOME ?? process.cwd();

    const spawn = async (): Promise<pty.IPty> => {
      const extra =
        (await opts.onCreatePty?.({ terminalId, request: req })) ?? ({} as JabtermPtyOptions);
      const shell = resolveDefaultShell(extra.shell ?? defaultShell);
      const cwd = extra.cwd ?? defaultCwd;
      const cols = Math.max(extra.cols ?? 80, 10);
      const rows = Math.max(extra.rows ?? 24, 10);
      const ptyEnv = { ...env, ...(extra.env ?? {}) };
      const args = extra.shellArgs ?? [];

      return pty.spawn(shell, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: ptyEnv,
      });
    };

    void (async () => {
      let ptyProcess: pty.IPty;
      try {
        ptyProcess = await spawn();
      } catch (err) {
        logger.error?.("pty_spawn_failed", {
          terminalId,
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to spawn PTY",
              }),
            );
          }
        } catch {
          /* ignore */
        }
        try {
          ws.close(1011, "pty_spawn_failed");
        } catch {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
        return;
      }

      ptys.add(ptyProcess);

      const session: Session = {
        terminalId,
        ws,
        pty: ptyProcess,
        ptyExited: false,
        wsClosed: false,
        helloVersion: undefined,
        onWsMessage: () => { },
      };
      sessions.add(session);

      const sendError = (message: string) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send(JSON.stringify({ type: "error", message }));
        } catch {
          /* ignore */
        }
      };

      ptyProcess.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(data);
          } catch (err) {
            logger.warn?.("ws_send_failed", {
              terminalId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      });

      const onWsMessage = (message: Buffer | string) => {
        if (session.wsClosed) return;
        if (session.ptyExited) {
          try {
            if (ws.readyState === WebSocket.OPEN) ws.close(1011, "pty_exited");
          } catch {
            /* ignore */
          }
          return;
        }

        let handled = false;
        try {
          const msgStr = message.toString();
          if (msgStr.startsWith("{")) {
            const control = JSON.parse(msgStr) as unknown;
            if (typeof control === "object" && control) {
              const t = (control as any).type;
              if (t === "hello") {
                const version = Number((control as any).version);
                session.helloVersion = Number.isFinite(version) ? version : undefined;
                handled = true;

                if (session.helloVersion !== JABTERM_PROTOCOL_VERSION) {
                  sendError(
                    `Protocol mismatch: client=${String(
                      (control as any).version,
                    )} server=${JABTERM_PROTOCOL_VERSION}`,
                  );
                  try {
                    ws.close(1002, "protocol_mismatch");
                  } catch {
                    /* ignore */
                  }
                  try {
                    ptyProcess.kill();
                  } catch {
                    /* ignore */
                  }
                  session.wsClosed = true;
                  return;
                }
              } else if (t === "resize") {
                const cols = Math.max(Number((control as any).cols) || 80, 10);
                const rows = Math.max(Number((control as any).rows) || 24, 10);
                try {
                  ptyProcess.resize(cols, rows);
                  logger.debug?.("pty_resize", { terminalId, cols, rows });
                } catch (resizeErr) {
                  logger.warn?.("pty_resize_failed", {
                    terminalId,
                    error:
                      resizeErr instanceof Error ? resizeErr.message : String(resizeErr),
                  });
                  sendError("Resize failed");
                }
                handled = true;
              }
            }
          }
        } catch {
          // Not a valid control message, treat as input
        }

        if (!handled) {
          try {
            ptyProcess.write(message.toString("utf-8"));
          } catch (err) {
            logger.warn?.("pty_write_failed", {
              terminalId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      };
      session.onWsMessage = onWsMessage;
      ws.on("message", onWsMessage);

      ws.on("close", () => {
        session.wsClosed = true;
        logger.info?.("ws_disconnected", { terminalId });
        try {
          if (!session.ptyExited) ptyProcess.kill();
        } catch {
          /* ignore */
        }
      });

      ws.on("error", (err) => {
        logger.warn?.("ws_error", {
          terminalId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      ptyProcess.onExit(({ exitCode, signal }) => {
        session.ptyExited = true;
        logger.info?.("pty_exit", { terminalId, exitCode, signal });
        ptys.delete(ptyProcess);
        sessions.delete(session);
        try {
          ws.off("message", onWsMessage);
        } catch {
          /* ignore */
        }
        if (!session.wsClosed && ws.readyState === WebSocket.OPEN) {
          if (exitCode !== 0) {
            sendError(`PTY exited with code ${exitCode}`);
          }
        }
        if (!session.wsClosed && ws.readyState === WebSocket.OPEN) {
          const ok = exitCode === 0;
          try {
            ws.close(ok ? 1000 : 1011, ok ? "pty_exit" : "pty_error");
          } catch {
            /* ignore */
          }
        }
      });
    })();
  });

  async function listen(): Promise<JabtermServerAddress> {
    if (listened) return address();
    if (strictPort && port !== 0) await assertPortFree(port);

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, () => {
        listened = true;
        httpServer.off("error", reject);
        resolve();
      });
    });

    const addr = address();
    logger.info?.("listening", { host: addr.address, port: addr.port, path: basePath });
    return addr;
  }

  function address(): JabtermServerAddress {
    const addr = httpServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Server is not listening");
    }
    return { address: addr.address, family: addr.family, port: addr.port };
  }

  async function close(): Promise<void> {
    if (closePromise) return closePromise;
    closing = true;
    logger.info?.("shutting_down");

    const killAndCloseClients = async () => {
      // Phase 1: Close all WS connections and detach message handlers
      for (const session of sessions) {
        try {
          session.wsClosed = true;
          try {
            session.ws.off("message", session.onWsMessage);
          } catch {
            /* ignore */
          }
          if (
            session.ws.readyState === WebSocket.OPEN ||
            session.ws.readyState === WebSocket.CONNECTING
          ) {
            try {
              session.ws.close(1001, "server_shutdown");
            } catch {
              /* ignore */
            }
          }
          try {
            session.ws.terminate();
          } catch {
            /* ignore */
          }
        } catch {
          /* ignore */
        }
      }

      // Wait for WS close frames to be processed and onData handlers to detach.
      // Without this, killing PTY while onData is still wired to a closing WS
      // triggers an uncatchable native C++ exception in node-pty (SIGABRT).
      await new Promise<void>((r) => setTimeout(r, 100));

      // Phase 2: Kill PTY processes (safe — WS clients are disconnected)
      for (const session of sessions) {
        try {
          if (!session.ptyExited) session.pty.kill();
        } catch {
          /* ignore */
        }
      }
      for (const p of ptys) {
        try {
          p.kill();
        } catch {
          /* ignore */
        }
      }
      sessions.clear();
      ptys.clear();
    };

    closePromise = (async () => {
      await killAndCloseClients();
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        try {
          wss.close(() => finish());
        } catch {
          finish();
        }
        setTimeout(finish, 2000).unref?.();
      });

      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        try {
          httpServer.close(() => finish());
        } catch {
          finish();
        }
        setTimeout(finish, 2000).unref?.();
      });
    })();

    return closePromise;
  }

  // Improve shutdown hygiene in tests/CI: if the parent process is exiting, terminate sessions quickly.
  if (process.env.CI) {
    process.once("beforeExit", () => {
      if (closing) return;
      // fire-and-forget
      void close();
    });
  }

  // Give the user a hint about the current platform defaults.
  logger.debug?.("server_created", {
    platform: process.platform,
    cpus: os.cpus()?.length ?? undefined,
    basePath,
  });

  return { wss, listen, close, address };
}

