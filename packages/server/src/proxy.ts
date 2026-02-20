import { WebSocketServer, WebSocket } from "ws";
import { normalizeCloseCode, normalizeCloseReason } from "./utils.js";

export interface TerminalProxyOptions {
  /** Upstream terminal server URL, e.g. ws://127.0.0.1:3223 */
  upstreamUrl: string;
}

/**
 * Creates a WebSocketServer (noServer mode) that bridges browser connections
 * to an upstream JabTerm server. Useful for same-origin proxying through
 * HTTPS/Cloudflare/tunnel setups.
 *
 * The caller is responsible for handling HTTP upgrade events and calling
 * `wss.handleUpgrade(req, socket, head, cb)`.
 */
export function createTerminalProxy(
  opts: TerminalProxyOptions,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (browserSocket: WebSocket) => {
    const upstream = new WebSocket(opts.upstreamUrl);
    const pending: Array<{ data: Buffer | ArrayBuffer | Buffer[]; isBinary: boolean }> = [];

    browserSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (upstream.readyState === WebSocket.OPEN) {
        try {
          upstream.send(data, { binary: isBinary });
        } catch {
          try {
            browserSocket.close(1011, "Terminal bridge send failed");
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (upstream.readyState === WebSocket.CONNECTING && pending.length < 100) {
        pending.push({ data, isBinary });
      }
    });

    browserSocket.on("close", () => {
      if (
        upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING
      ) {
        try {
          upstream.close(1000, "Browser closed");
        } catch {
          /* ignore */
        }
      }
    });

    browserSocket.on("error", () => {
      if (
        upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING
      ) {
        try {
          upstream.terminate();
        } catch {
          /* ignore */
        }
      }
    });

    upstream.on("open", () => {
      for (const frame of pending.splice(0)) {
        try {
          upstream.send(frame.data, { binary: frame.isBinary });
        } catch {
          try {
            browserSocket.close(1011, "Terminal bridge replay failed");
          } catch {
            /* ignore */
          }
          break;
        }
      }
    });

    upstream.on("message", (data: Buffer, isBinary: boolean) => {
      if (browserSocket.readyState !== WebSocket.OPEN) return;
      try {
        browserSocket.send(data, { binary: isBinary });
      } catch {
        try {
          browserSocket.close(1011, "Terminal bridge send failed");
        } catch {
          /* ignore */
        }
      }
    });

    upstream.on("close", (code: number, reason: Buffer) => {
      if (
        browserSocket.readyState !== WebSocket.OPEN &&
        browserSocket.readyState !== WebSocket.CONNECTING
      )
        return;
      const safeCode = normalizeCloseCode(code);
      const safeReason = normalizeCloseReason(reason).slice(0, 123);
      try {
        browserSocket.close(safeCode, safeReason);
      } catch {
        /* ignore */
      }
    });

    upstream.on("error", () => {
      if (
        browserSocket.readyState === WebSocket.OPEN ||
        browserSocket.readyState === WebSocket.CONNECTING
      ) {
        try {
          browserSocket.close(1011, "Terminal upstream unavailable");
        } catch {
          /* ignore */
        }
      }
    });
  });

  return wss;
}
