import { describe, expect, it, vi } from "vitest";

import { WebSocket } from "ws";

type ExitHandler = (e: { exitCode: number; signal?: number }) => void;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock("node-pty", () => {
  return {
    spawn: vi.fn(() => {
      let onExit: ExitHandler | null = null;
      let killed = false;
      return {
        onData() {
          // ignore
        },
        onExit(cb: ExitHandler) {
          onExit = cb;
        },
        write() {
          // ignore
        },
        resize() {
          // ignore
        },
        kill() {
          if (killed) return;
          killed = true;
          onExit?.({ exitCode: 0 });
        },
      };
    }),
  };
});

describe("createJabtermServer().close()", () => {
  it("is idempotent and returns the same promise for concurrent callers", async () => {
    const { createJabtermServer } = await import("../../../src/server/jabtermServer.js");

    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    const server = createJabtermServer({ host: "127.0.0.1", port: 0, logger });
    const addr = await server.listen();

    const wsClosed = deferred<void>();
    const ws = new WebSocket(`ws://${addr.address}:${addr.port}/`);
    ws.once("open", () => {
      // Trigger an active session to exist.
      ws.send(JSON.stringify({ type: "hello", version: 1 }));
    });
    ws.once("close", () => wsClosed.resolve());
    ws.once("error", (e) => wsClosed.reject(e));

    // Ensure the connection attempt has started.
    await new Promise<void>((r) => setTimeout(r, 25));

    const p1 = server.close();
    const p2 = server.close();
    expect(p2).toBe(p1);

    await Promise.all([p1, p2, wsClosed.promise]);
    expect(() => server.address()).toThrow(/not listening/i);

    // Already-closed calls should keep working.
    await expect(server.close()).resolves.toBeUndefined();
  });
});

