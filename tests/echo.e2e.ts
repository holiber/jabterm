/**
 * Terminal Echo Test — WebSocket protocol layer.
 *
 * Connects directly to the JabTerm server, sends an echo command
 * with a unique sentinel, and asserts the response appears in the output.
 */

import { test, expect } from "@playwright/test";
import { WebSocket as WsClient } from "ws";
import {
  defaultWsUrl,
  openTerminal,
  sendCommand,
  waitForMatch,
} from "./helpers/ws.js";

const WS_URL = defaultWsUrl();

test.describe.configure({ mode: "serial" });

test.describe("Terminal — echo round-trip (WS protocol)", () => {
  test("echo command returns output", async () => {
    let ws!: WsClient;
    try {
      ws = await openTerminal(WS_URL);
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

