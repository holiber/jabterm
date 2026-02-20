import { WebSocket as WsClient } from "ws";

export function defaultWsUrl(): string {
  return (
    process.env.JABTERM_WS_URL ||
    `ws://127.0.0.1:${process.env.JABTERM_PORT || "3223"}`
  );
}

export function waitForMatch(
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

export function sendCommand(ws: WsClient, cmd: string): void {
  ws.send(Buffer.from(cmd + "\n"));
}

export async function waitForWsOpen(ws: WsClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

export async function openTerminal(wsUrl = defaultWsUrl()): Promise<WsClient> {
  const ws = new WsClient(wsUrl);
  await waitForWsOpen(ws);

  // Wait for first output (prompt/banner)
  await waitForMatch(ws, /.+/s, 4000);

  // Proactively resize so shells with tiny defaults behave
  ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 30 }));
  try {
    await waitForMatch(ws, /.+/s, 750);
  } catch {
    /* ignore */
  }

  return ws;
}

