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

  test("rejects hello protocol version mismatch with error frame", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
    });
    const addr = await server.listen();

    const ws = new WsClient(wsUrl(addr.port, "/ws/mismatch"));
    await waitForWsOpen(ws);
    ws.send(JSON.stringify({ type: "hello", version: 999 }));

    const raw = await waitForMatch(ws, /"type"\s*:\s*"error"/, 8000);
    expect(raw).toContain("Protocol mismatch");

    await new Promise((resolve) => ws.once("close", resolve));
    await server.close();
  });

  test("supports authenticate hook", async () => {
    const TOKEN = "secret-token";
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
      authenticate(req) {
        return req.headers.authorization === `Bearer ${TOKEN}`;
      },
    });
    const addr = await server.listen();

    const wsDenied = new WsClient(wsUrl(addr.port, "/ws/denied"));
    const denied = await new Promise<"open" | "error">((resolve) => {
      wsDenied.once("open", () => resolve("open"));
      wsDenied.once("error", () => resolve("error"));
    });
    expect(denied).toBe("error");

    const wsAllowed = new WsClient(wsUrl(addr.port, "/ws/allowed"), {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await waitForWsOpen(wsAllowed);
    wsAllowed.close();

    await server.close();
  });

  test("supports allowedOrigins policy", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
      allowedOrigins: ["https://allowed.example"],
    });
    const addr = await server.listen();

    const wsDenied = new WsClient(wsUrl(addr.port, "/ws/denied"), {
      origin: "https://denied.example",
    });
    const denied = await new Promise<"open" | "error">((resolve) => {
      wsDenied.once("open", () => resolve("open"));
      wsDenied.once("error", () => resolve("error"));
    });
    expect(denied).toBe("error");

    const wsAllowed = new WsClient(wsUrl(addr.port, "/ws/allowed"), {
      origin: "https://allowed.example",
    });
    await waitForWsOpen(wsAllowed);
    wsAllowed.close();

    await server.close();
  });

  test("supports onCreatePty per-terminal config", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
      onCreatePty({ terminalId }) {
        return {
          cwd: "/tmp",
          env: {
            JABTERM_TEST_TERMINAL_ID: terminalId ?? "",
            JABTERM_TEST_FLAG: terminalId === "a" ? "A" : "B",
          },
          cols: terminalId === "a" ? 100 : 90,
          rows: terminalId === "a" ? 40 : 30,
        };
      },
    });
    const addr = await server.listen();

    const wsA = new WsClient(wsUrl(addr.port, "/ws/a"));
    await waitForWsOpen(wsA);
    await waitForMatch(wsA, /.+/s, 4000);
    wsA.send(Buffer.from("pwd\n"));
    wsA.send(Buffer.from("echo __TID__${JABTERM_TEST_TERMINAL_ID}__\n"));
    wsA.send(Buffer.from("echo __FLAG__${JABTERM_TEST_FLAG}__\n"));
    const outA = await waitForMatch(wsA, /__FLAG__A__/, 8000);
    expect(outA).toContain("/tmp");
    expect(outA).toContain("__TID__a__");
    wsA.close();

    const wsB = new WsClient(wsUrl(addr.port, "/ws/b"));
    await waitForWsOpen(wsB);
    await waitForMatch(wsB, /.+/s, 4000);
    wsB.send(Buffer.from("pwd\n"));
    wsB.send(Buffer.from("echo __TID__${JABTERM_TEST_TERMINAL_ID}__\n"));
    wsB.send(Buffer.from("echo __FLAG__${JABTERM_TEST_FLAG}__\n"));
    const outB = await waitForMatch(wsB, /__FLAG__B__/, 8000);
    expect(outB).toContain("/tmp");
    expect(outB).toContain("__TID__b__");
    wsB.close();

    await server.close();
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

  test("sends ptyExit message before websocket close", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
    });
    const addr = await server.listen();

    const ws = new WsClient(wsUrl(addr.port, "/ws/exit"));
    await waitForWsOpen(ws);
    await waitForMatch(ws, /.+/s, 4000);

    ws.send(Buffer.from("exit\n"));
    const raw = await waitForMatch(ws, /"type"\s*:\s*"ptyExit"/, 8000);
    expect(raw).toContain("\"ptyExit\"");

    await new Promise((resolve) => ws.once("close", resolve));
    await server.close();
  });

  test("shellIntegration emits commandEnd with exit code (bash best-effort)", async () => {
    const server = createJabtermServer({
      host: "127.0.0.1",
      port: 0,
      path: "/ws",
      shellIntegration: true,
    });
    const addr = await server.listen();

    const ws = new WsClient(wsUrl(addr.port, "/ws/cmdend"));
    await waitForWsOpen(ws);
    await waitForMatch(ws, /.+/s, 4000);

    ws.send(Buffer.from("false\n"));
    const raw = await waitForMatch(
      ws,
      /"type"\s*:\s*"commandEnd"[\s\S]*"exitCode"\s*:\s*1/,
      8000,
    );
    expect(raw).toContain("\"commandEnd\"");

    ws.close();
    await server.close();
  });
});

