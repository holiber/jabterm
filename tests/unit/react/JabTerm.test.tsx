import React, { createRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { JabTermHandle } from "../../../src/react/types.js";
import JabTerm from "../../../src/react/JabTerm.js";

let lastTerminal: any = null;
let lastTerminalOptions: any = null;

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

    constructor(options?: any) {
      lastTerminal = this;
      lastTerminalOptions = options ?? null;
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
  const countResizeMessages = (ws: any) =>
    ws.sent.filter((x: unknown) => typeof x === "string" && x.includes("\"resize\"")).length;

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

  it("calls onData for incoming output", async () => {
    const onData = vi.fn();
    render(<JabTerm wsUrl="ws://example.test/ws" onData={onData} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    act(() => ws.__message("hello\n"));
    expect(onData).toHaveBeenCalledWith("hello\n");
  });

  it("handles commandEnd messages (callback + handle helpers) without writing JSON to terminal", async () => {
    const ref = createRef<JabTermHandle>();
    const onCommandEnd = vi.fn();
    render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} onCommandEnd={onCommandEnd} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    expect(ref.current!.getLastExitCode()).toBeNull();
    const beforeWrites = lastTerminal.write.mock.calls.length;

    const p = ref.current!.waitForCommandEnd(1000);
    act(() => ws.__message(JSON.stringify({ type: "commandEnd", exitCode: 7 })));

    await expect(p).resolves.toBe(7);
    expect(ref.current!.getLastExitCode()).toBe(7);
    expect(onCommandEnd).toHaveBeenCalledWith(7);
    expect(lastTerminal.write.mock.calls.length).toBe(beforeWrites);
    expect(ref.current!.readNew()).toBe("");
  });

  it("handles ptyExit messages via onExit without writing JSON to terminal", async () => {
    const onExit = vi.fn();
    render(<JabTerm wsUrl="ws://example.test/ws" onExit={onExit} />);

    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    const beforeWrites = lastTerminal.write.mock.calls.length;
    act(() => ws.__message(JSON.stringify({ type: "ptyExit", exitCode: 0, signal: null })));

    expect(onExit).toHaveBeenCalledWith(0, null);
    expect(lastTerminal.write.mock.calls.length).toBe(beforeWrites);
  });

  it("writeAndWait resolves on quiet output stabilization", async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<JabTermHandle>();
      render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} />);
      const ws = getMockWs();
      act(() => ws.__open());

      const p = ref.current!.writeAndWait("echo hi\n", { quietMs: 50, timeout: 1000 });
      act(() => ws.__message("hi\n"));

      await act(async () => {
        vi.advanceTimersByTime(60);
        await Promise.resolve();
      });

      await expect(p).resolves.toEqual({ output: "hi\n" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("writeAndWait resolves when waitFor marker appears", async () => {
    const ref = createRef<JabTermHandle>();
    render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} />);
    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    const p = ref.current!.writeAndWait("noop\n", { waitFor: "READY", timeout: 1000 });
    act(() => ws.__message("not yet\n"));
    act(() => ws.__message("READY\n"));

    await expect(p).resolves.toEqual({ output: "not yet\nREADY\n" });
  });

  it("writeAndWait can resolve on commandEnd and return exitCode", async () => {
    const ref = createRef<JabTermHandle>();
    render(<JabTerm wsUrl="ws://example.test/ws" ref={ref} />);
    const ws = await waitFor(() => {
      const cur = getMockWs();
      expect(cur).toBeTruthy();
      return cur;
    });
    act(() => ws.__open());

    const p = ref.current!.writeAndWait("false\n", { waitForCommand: true, timeout: 1000 });
    act(() => ws.__message("running...\n"));
    act(() => ws.__message(JSON.stringify({ type: "commandEnd", exitCode: 1 })));

    await expect(p).resolves.toEqual({ output: "running...\n", exitCode: 1 });
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

  it("passes accessibilitySupport to xterm Terminal options", async () => {
    lastTerminalOptions = null;
    render(<JabTerm wsUrl="ws://example.test/ws" accessibilitySupport="on" />);
    await waitFor(() => {
      expect(lastTerminalOptions).toBeTruthy();
    });
    expect(lastTerminalOptions.accessibilitySupport).toBe("on");
  });

  it("deduplicates resize messages when dimensions do not change", () => {
    vi.useFakeTimers();
    try {
      render(<JabTerm wsUrl="ws://example.test/ws" />);
      const ws = getMockWs();
      expect(ws).toBeTruthy();

      act(() => ws.__open());
      const initialResizeCount = countResizeMessages(ws);
      expect(initialResizeCount).toBeGreaterThanOrEqual(1);

      act(() => {
        vi.advanceTimersByTime(150);
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
      });

      expect(countResizeMessages(ws)).toBe(initialResizeCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends resize when terminal dimensions change", () => {
    vi.useFakeTimers();
    try {
      render(<JabTerm wsUrl="ws://example.test/ws" />);
      const ws = getMockWs();
      expect(ws).toBeTruthy();

      act(() => ws.__open());
      act(() => vi.advanceTimersByTime(150));
      const before = countResizeMessages(ws);

      expect(lastTerminal).toBeTruthy();
      lastTerminal.cols = 120;
      lastTerminal.rows = 40;

      act(() => window.dispatchEvent(new Event("resize")));
      expect(countResizeMessages(ws)).toBe(before + 1);
      expect(String(ws.sent[ws.sent.length - 1])).toContain("\"cols\":120");
      expect(String(ws.sent[ws.sent.length - 1])).toContain("\"rows\":40");
    } finally {
      vi.useRealTimers();
    }
  });
});

