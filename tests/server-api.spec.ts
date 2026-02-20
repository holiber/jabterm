import { test, expect } from "@playwright/test";
import { WebSocket as WsClient } from "ws";

import { createJabtermServer } from "../dist/server/index.js";

function wsUrl(port: number, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `ws://127.0.0.1:${port}${p}`;
}

async function waitForWsOpen(ws: WsClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function waitForMatch(
  ws: WsClient,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let buf = "";

    const onMessage = (data: Buffer | string) => {
      buf += data.toString();
      if (pattern.test(buf)) cleanup(true);
    };
    const onError = (err: unknown) => cleanup(false, err);
    const onClose = () => cleanup(false, new Error("WebSocket closed"));

    const timer = setInterval(() => {
      if (Date.now() - startedAt > timeoutMs) {
        cleanup(
          false,
          new Error(`Timeout waiting for ${pattern}. Last output:\n${buf}`),
        );
      }
    }, 50);

    function cleanup(ok: boolean, err?: unknown) {
      clearInterval(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
      if (ok) resolve(buf);
      else reject(err);
    }

    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Server API — createJabtermServer", () => {
  test("supports ephemeral port and deterministic shutdown", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
      strictPort: true,
    });

    const addr = await server.listen();
    expect(addr.port).toBeGreaterThan(0);

    const ws = new WsClient(wsUrl(addr.port, "/ws/test-terminal"));
    await waitForWsOpen(ws);

    await waitForMatch(ws, /.+/s, 4000);
    ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));

    ws.send(Buffer.from("echo __PID__$$__END__\n"));
    const rawOutput = await waitForMatch(ws, /__PID__(\d+)__END__/, 8000);
    const pidMatch = rawOutput.match(/__PID__(\d+)__END__/);
    expect(pidMatch).not.toBeNull();
    const shellPid = pidMatch![1];

    const { execSync } = await import("child_process");
    execSync(`kill -0 ${shellPid} 2>/dev/null`);

    await server.close();

    await new Promise((resolve) => setTimeout(resolve, 400));

    let isRunningAfter = false;
    try {
      execSync(`kill -0 ${shellPid} 2>/dev/null`);
      isRunningAfter = true;
    } catch {
      isRunningAfter = false;
    }
    expect(isRunningAfter).toBe(false);
  });

  test("rejects upgrades outside configured path", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
    });
    const addr = await server.listen();

    const ws = new WsClient(wsUrl(addr.port, "/not-ws"));
    const result = await new Promise<"open" | "error">((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("error"));
    });

    try {
      ws.close();
    } catch {
      /* ignore */
    }
    await server.close();

    expect(result).toBe("error");
  });
});

