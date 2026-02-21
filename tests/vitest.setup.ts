import "@testing-library/jest-dom/vitest";

// JSDOM doesn't implement ResizeObserver; provide a minimal stub so `JabTerm`
// exercises the observe/disconnect paths deterministically in unit tests.
class ResizeObserverStub {
  observe(): void {
    // no-op
  }
  disconnect(): void {
    // no-op
  }
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

type MockMessage = string | ArrayBuffer;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  binaryType: unknown = "blob";
  url: string;

  sent: unknown[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.closeCalls.push({ code, reason });
    // The component guards on `disposedRef`, so triggering onclose is optional.
  }

  __open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  __message(data: MockMessage): void {
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  __error(): void {
    this.onerror?.(new Event("error"));
  }

  __serverClose(code = 1000, reason = "server_close"): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

