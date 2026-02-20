import net from "net";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function isExecutableFile(p: string): boolean {
  try {
    if (!p) return false;
    fs.accessSync(p, fs.constants.X_OK);
    const st = fs.statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a reasonable default shell for node-pty on the current OS.
 *
 * Order:
 * - explicit user-provided `shell` if set
 * - `process.env.SHELL` if it exists and is executable
 * - OS-specific common absolute paths (Linux prefers bash/sh; macOS prefers zsh)
 * - finally fall back to PATH lookup (`bash` then `sh`)
 */
export function resolveDefaultShell(explicitShell?: string): string {
  if (explicitShell) return explicitShell;

  if (process.platform === "win32") return "powershell.exe";

  const envShell = process.env.SHELL;
  if (envShell && isExecutableFile(envShell)) return envShell;

  const candidates =
    process.platform === "darwin"
      ? ["/bin/zsh", "/usr/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"]
      : [
          "/bin/bash",
          "/usr/bin/bash",
          "/bin/sh",
          "/usr/bin/sh",
          "/bin/zsh",
          "/usr/bin/zsh",
        ];

  for (const c of candidates) {
    if (isExecutableFile(c)) return c;
  }

  return "bash";
}

export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use`));
        return;
      }
      reject(err);
    });
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(port, "127.0.0.1");
  });
}

export function ensureNodePtySpawnHelperExecutable(): void {
  try {
    const unixTerminalPath = require.resolve("node-pty/lib/unixTerminal.js");
    const pkgRoot = path.resolve(path.dirname(unixTerminalPath), "..");
    const helper = path.join(
      pkgRoot,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    );

    if (!fs.existsSync(helper)) return;
    const st = fs.statSync(helper);
    if ((st.mode & 0o111) !== 0) return;
    console.log(`[jabterm] Fixing permissions for ${helper}`);
    fs.chmodSync(helper, 0o755);
  } catch (e) {
    console.error("[jabterm] Failed to ensure spawn helper permissions:", e);
  }
}

export function safeLocale(): string {
  return (
    process.env.LC_ALL ??
    process.env.LANG ??
    (process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8")
  );
}

export function normalizeCloseCode(code: unknown): number {
  const n = Number(code);
  if (!Number.isInteger(n)) return 1000;
  if (n < 1000 || n > 4999) return 1000;
  if (n === 1005 || n === 1006 || n === 1015) return 1000;
  return n;
}

export function normalizeCloseReason(reason: unknown): string {
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  if (Buffer.isBuffer(reason)) return reason.toString("utf8");
  if (reason instanceof Uint8Array) return Buffer.from(reason).toString("utf8");
  return String(reason);
}
