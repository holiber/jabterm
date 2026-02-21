import React, { createRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { JabTermHandle } from "../../../src/react/types.js";
import JabTerm from "../../../src/react/JabTerm.js";

let lastTerminal: any = null;

vi.mock("@xterm/addon-fit", () => {
  return {
    FitAddon: class FitAddon {
      fit = vi.fn();
    },
  };
});

vi.mock("@xterm/xterm", () => {
  class Terminal {
    cols = 80;
    rows = 24;
    write = vi.fn();
    focus = vi.fn();
    resize = vi.fn((cols: number, rows: number) => {
      this.cols = cols;
      this.rows = rows;
    });
    loadAddon = vi.fn();
    open = vi.fn();
    dispose = vi.fn();

    private onDataHandlers: Array<(data: string) => void> = [];
    private onTitleHandlers: Array<(title: string) => void> = [];

    constructor() {
      lastTerminal = this;
    }

    onData(cb: (data: string) => void) {
      this.onDataHandlers.push(cb);
    }

    onTitleChange(cb: (title: string) => void) {
      this.onTitleHandlers.push(cb);
    }

    __emitData(data: string) {
      for (const cb of this.onDataHandlers) cb(data);
    }

    __emitTitle(title: string) {
      for (const cb of this.onTitleHandlers) cb(title);
    }
  }

  return {
    Terminal,
    default: { Terminal },
    __getLastTerminal: () => lastTerminal,
  };
});

function getMockWs() {
  const WS = (globalThis as unknown as { WebSocket: any }).WebSocket;
  return WS.instances[WS.instances.length - 1];
}

describe("<JabTerm />", () => {
  it("handshakes on open and captures incoming output", async () => {
    const ref = createRef<JabTermHandle>();
    render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });

    act(() => ws.__open());

    expect(ws.sent.length).toBeGreaterThanOrEqual(2);
    expect(String(ws.sent[0])).toContain("\"hello\"");
    expect(String(ws.sent[ws.sent.length - 1])).toContain("\"resize\"");

    act(() => ws.__message("hello from server\n"));
    const out = ref.current!.readNew();
    expect(out).toContain("hello from server");
  });

  it("does not capture output when captureOutput is false", async () => {
    const ref = createRef<JabTermHandle>();
    render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} captureOutput={false} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());
    act(() => ws.__message("x\n"));
    expect(ref.current!.readNew()).toBe("");
  });

  it("clamps resize and sends resize message when open", async () => {
    const ref = createRef<JabTermHandle>();
    render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    act(() => ref.current!.resize(1, 1));
    expect(String(ws.sent[ws.sent.length - 1])).toContain("\"resize\"");
    expect(String(ws.sent[ws.sent.length - 1])).toContain("\"cols\":10");
    expect(String(ws.sent[ws.sent.length - 1])).toContain("\"rows\":10");
  });

  it("cleans up websocket and terminal on unmount", async () => {
    const ref = createRef<JabTermHandle>();
    const r = render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    act(() => r.unmount());

    expect(ws.closeCalls.length).toBeGreaterThanOrEqual(1);
    const last = ws.closeCalls[ws.closeCalls.length - 1];
    expect(last.code).toBe(1000);
    expect(last.reason).toBe("component_unmount");

    expect(lastTerminal).toBeTruthy();
    expect(lastTerminal.dispose).toHaveBeenCalled();
  });
});

