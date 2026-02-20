/**
 * Terminal Zombie Process Test.
 *
 * Verifies that PTY processes are killed when the WebSocket closes,
 * preventing zombie/orphaned processes.
 */

import { test, expect } from "@playwright/test";
import { WebSocket as WsClient } from "ws";

const WS_URL =
  process.env.JABTERM_WS_URL ||
  `ws://127.0.0.1:${process.env.JABTERM_PORT || "3223"}`;
const CLEANUP_DELAY_MS = 1500;

test.describe.configure({ mode: "serial" });

function waitForMatch(
  ws: WsClient,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
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

function sendCommand(ws: WsClient, cmd: string): void {
  ws.send(Buffer.from(cmd + "\n"));
}

test.describe("Terminal — zombie process prevention", () => {
  test("pty process is killed when websocket closes", async () => {
    const ws = new WsClient(WS_URL);

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    await waitForMatch(ws, /.+/s, 4000);
    ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));
    try {
      await waitForMatch(ws, /.+/s, 1000);
    } catch {
      /* ignore */
    }

    sendCommand(ws, "echo __PID__$$__END__");

    const rawOutput = await waitForMatch(ws, /__PID__(\d+)__END__/, 8000);
    const pidMatch = rawOutput.match(/__PID__(\d+)__END__/);
    expect(pidMatch).not.toBeNull();

    const shellPid = pidMatch![1];

    const { execSync } = await import("child_process");
    let isRunningBefore: boolean;
    try {
      execSync(`kill -0 ${shellPid} 2>/dev/null`);
      isRunningBefore = true;
    } catch {
      isRunningBefore = false;
    }
    expect(isRunningBefore).toBe(true);

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, CLEANUP_DELAY_MS));

    let isRunningAfter: boolean;
    try {
      execSync(`kill -0 ${shellPid} 2>/dev/null`);
      isRunningAfter = true;
    } catch {
      isRunningAfter = false;
    }

    let isZombie = false;
    try {
      const psOut = execSync(
        `ps -p ${shellPid} -o stat= 2>/dev/null || true`,
      ).toString();
      isZombie = psOut.includes("Z");
    } catch {
      /* process doesn't exist — expected */
    }

    expect(isRunningAfter).toBe(false);
    expect(isZombie).toBe(false);
  });

  test("multiple terminals close cleanly", async () => {
    const { execSync } = await import("child_process");
    const pids: string[] = [];

    const sockets: WsClient[] = [];
    for (let i = 0; i < 3; i++) {
      const ws = new WsClient(WS_URL);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      sockets.push(ws);

      await waitForMatch(ws, /.+/s, 4000);
      ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));

      sendCommand(ws, `echo __PID__$$__END__`);
      const out = await waitForMatch(ws, /__PID__(\d+)__END__/, 8000);
      const m = out.match(/__PID__(\d+)__END__/);
      if (m) pids.push(m[1]);
    }

    expect(pids.length).toBe(3);

    for (const pid of pids) {
      let running: boolean;
      try {
        execSync(`kill -0 ${pid} 2>/dev/null`);
        running = true;
      } catch {
        running = false;
      }
      expect(running).toBe(true);
    }

    for (const ws of sockets) ws.close();

    await new Promise((resolve) =>
      setTimeout(resolve, CLEANUP_DELAY_MS * 1.5),
    );

    for (const pid of pids) {
      let running: boolean;
      try {
        execSync(`kill -0 ${pid} 2>/dev/null`);
        running = true;
      } catch {
        running = false;
      }

      let isZombie = false;
      try {
        const psOut = execSync(
          `ps -p ${pid} -o stat= 2>/dev/null || true`,
        ).toString();
        isZombie = psOut.includes("Z");
      } catch {
        /* ok */
      }

      expect(running).toBe(false);
      expect(isZombie).toBe(false);
    }
  });
});
