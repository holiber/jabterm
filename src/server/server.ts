import { type WebSocketServer } from "ws";
import { createJabtermServer } from "./jabtermServer.js";

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
  const server = createJabtermServer({
    port: opts?.port ?? 3223,
    host: opts?.host ?? "127.0.0.1",
    path: "/",
    shell: opts?.shell,
    cwd: opts?.cwd,
    strictPort: opts?.strictPort ?? false,
  });

  await server.listen();
  const addr = server.address();
  return { wss: server.wss, port: addr.port, close: () => server.close() };
}
