/**
 * Terminal Echo Test — WebSocket protocol layer.
 *
 * Connects directly to the JabTerm server, sends an echo command
 * with a unique sentinel, and asserts the response appears in the output.
 */

import { test, expect } from "@playwright/test";
import { WebSocket as WsClient } from "ws";

const WS_URL =
  process.env.JABTERM_WS_URL ||
  `ws://127.0.0.1:${process.env.JABTERM_PORT || "3223"}`;

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

async function openTerminal(): Promise<WsClient> {
  const ws = new WsClient(WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await waitForMatch(ws, /.+/s, 4000);
  ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 30 }));
  try {
    await waitForMatch(ws, /.+/s, 750);
  } catch {
    /* ignore */
  }
  return ws;
}

test.describe("Terminal — echo round-trip (WS protocol)", () => {
  test("echo command returns output", async () => {
    let ws!: WsClient;
    try {
      ws = await openTerminal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not connect to terminal WS at ${WS_URL}: ${msg}\n` +
          "Make sure the terminal server is running.",
      );
    }

    const SENTINEL = `__JABTERM_ECHO_${Date.now()}__`;
    sendCommand(ws, `echo ${SENTINEL}`);

    const output = await waitForMatch(
      ws,
      new RegExp(SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      8000,
    );

    ws.close();

    expect(output).toContain(SENTINEL);
  });

  test("terminal server is reachable", async () => {
    const ws = new WsClient(WS_URL);

    const result = await new Promise<"open" | "close" | "error">((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("error"));
      ws.once("close", () => resolve("close"));
    });

    if (ws.readyState === WsClient.OPEN) ws.close();

    expect(result).toBe("open");
  });
});
