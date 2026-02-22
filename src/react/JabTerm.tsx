"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as Xterm from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { JabTermHandle, JabTermProps, JabTermState } from "./types.js";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

const DEFAULT_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const JABTERM_PROTOCOL_VERSION = 1;

const JabTerm = forwardRef<JabTermHandle, JabTermProps>(function JabTerm(
  {
    wsUrl,
    onTitleChange,
    onOpen,
    onClose,
    onError,
    captureOutput = true,
    maxCaptureChars = 200_000,
    className,
    fontSize = 13,
    fontFamily = DEFAULT_FONT_FAMILY,
    accessibilitySupport,
    theme,
  },
  ref,
) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closingByCleanupRef = useRef(false);
  const disposedRef = useRef(false);
  const lastSentSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const [state, setState] = useState<JabTermState>("connecting");

  const captureEnabledRef = useRef<boolean>(captureOutput);
  const captureMaxCharsRef = useRef<number>(maxCaptureChars);
  const captureChunksRef = useRef<string[]>([]);
  const captureTotalRef = useRef<number>(0);
  const captureReadOffsetRef = useRef<number>(0);
  const decoderRef = useRef<TextDecoder | null>(null);

  captureEnabledRef.current = captureOutput;
  captureMaxCharsRef.current = maxCaptureChars;

  const sendResizeIfChanged = (cols: number, rows: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const last = lastSentSizeRef.current;
    if (last.cols === cols && last.rows === rows) return;
    lastSentSizeRef.current = { cols, rows };
    try {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    } catch {
      /* ignore */
    }
  };

  const appendCapture = (chunk: string) => {
    if (!captureEnabledRef.current) return;
    if (!chunk) return;
    const chunks = captureChunksRef.current;
    chunks.push(chunk);
    captureTotalRef.current += chunk.length;

    const max = Math.max(captureMaxCharsRef.current || 0, 1_000);
    while (captureTotalRef.current > max && chunks.length > 0) {
      const removed = chunks.shift()!;
      captureTotalRef.current -= removed.length;
      captureReadOffsetRef.current = Math.max(
        0,
        captureReadOffsetRef.current - removed.length,
      );
    }
  };

  const getCaptured = () => captureChunksRef.current.join("");

  useImperativeHandle(
    ref,
    (): JabTermHandle => ({
      focus() {
        try {
          xtermRef.current?.focus();
        } catch {
          /* ignore */
        }
      },
      fit() {
        try {
          fitAddonRef.current?.fit();
        } catch {
          /* ignore */
        }
      },
      resize(cols: number, rows: number) {
        const term = xtermRef.current;
        if (!term) return;
        const safeCols = Math.max(cols || 80, 10);
        const safeRows = Math.max(rows || 24, 10);
        try {
          term.resize(safeCols, safeRows);
        } catch {
          /* ignore */
        }
        sendResizeIfChanged(safeCols, safeRows);
      },
      paste(text: string) {
        const term = xtermRef.current;
        if (!term) return;
        try {
          // xterm 6+ supports paste(); fall back to write for older versions.
          (term as any).paste?.(text);
        } catch {
          try {
            term.write(text);
          } catch {
            /* ignore */
          }
        }
      },
      send(data: string | Uint8Array | ArrayBuffer) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
          if (typeof data === "string") {
            ws.send(new TextEncoder().encode(data));
          } else if (data instanceof ArrayBuffer) {
            ws.send(data);
          } else {
            ws.send(data);
          }
        } catch {
          /* ignore */
        }
      },
      getXterm() {
        return xtermRef.current;
      },
      readAll() {
        const s = getCaptured();
        captureReadOffsetRef.current = s.length;
        return s;
      },
      readLast(lines: number) {
        const s = getCaptured();
        const n = Math.max(Number(lines) || 0, 0);
        if (n === 0) return "";
        const parts = s.split(/\r?\n/);
        return parts.slice(Math.max(0, parts.length - n)).join("\n");
      },
      readNew() {
        const s = getCaptured();
        const start = Math.min(Math.max(captureReadOffsetRef.current, 0), s.length);
        const out = s.slice(start);
        captureReadOffsetRef.current = s.length;
        return out;
      },
      getNewCount() {
        const s = getCaptured();
        const start = Math.min(Math.max(captureReadOffsetRef.current, 0), s.length);
        return s.length - start;
      },
    }),
    [],
  );

  useEffect(() => {
    if (!terminalRef.current) return;
    closingByCleanupRef.current = false;
    disposedRef.current = false;
    lastSentSizeRef.current = { cols: 0, rows: 0 };
    setState("connecting");

    const TerminalCtor =
      // CDN (+esm) build exposes a named `Terminal` export.
      // npm ESM build uses a default export object with `.Terminal`.
      (Xterm as unknown as { Terminal?: unknown }).Terminal ??
      (Xterm as unknown as { default?: { Terminal?: unknown } }).default?.Terminal ??
      (Xterm as unknown as { "module.exports"?: { Terminal?: unknown } })["module.exports"]
        ?.Terminal;

    if (!TerminalCtor) {
      throw new Error("xterm Terminal export not found");
    }

    const term = new (TerminalCtor as unknown as new (
      options?: Record<string, unknown>,
    ) => XtermTerminal)({
      cursorBlink: true,
      fontFamily,
      fontSize,
      ...(accessibilitySupport !== undefined ? { accessibilitySupport } : {}),
      theme: {
        background: theme?.background ?? "#1e1e1e",
        foreground: theme?.foreground,
        cursor: theme?.cursor,
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposedRef.current) return;
      setState("open");
      onOpen?.();
      try {
        ws.send(JSON.stringify({ type: "hello", version: JABTERM_PROTOCOL_VERSION }));
      } catch {
        /* ignore */
      }
      fitAddon.fit();
      const cols = Math.max(term.cols || 80, 80);
      const rows = Math.max(term.rows || 24, 24);
      sendResizeIfChanged(cols, rows);
    };

    ws.onmessage = (event) => {
      if (disposedRef.current) return;
      if (typeof event.data === "string") {
        if (event.data.startsWith("{")) {
          try {
            const parsed = JSON.parse(event.data) as any;
            if (parsed?.type === "error" && typeof parsed.message === "string") {
              const msg = parsed.message.replace(/\r?\n/g, " ").slice(0, 500);
              term.write(`\r\n\x1b[31mError: ${msg}\x1b[0m\r\n`);
              appendCapture(`\nError: ${msg}\n`);
              return;
            }
          } catch {
            /* ignore */
          }
        }
        term.write(event.data);
        appendCapture(event.data);
      } else {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        term.write(bytes);
        try {
          if (!decoderRef.current) decoderRef.current = new TextDecoder();
          appendCapture(decoderRef.current.decode(bytes, { stream: true }));
        } catch {
          /* ignore */
        }
      }
    };

    ws.onclose = (e) => {
      if (disposedRef.current) return;
      setState("closed");
      onClose?.(e);
      if (closingByCleanupRef.current) return;
      term.write(
        `\r\n\x1b[31mConnection closed (code ${e.code})\x1b[0m\r\n`,
      );
    };

    ws.onerror = (e) => {
      if (disposedRef.current) return;
      onError?.(e);
    };

    const encoder = new TextEncoder();

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    term.onTitleChange((title: string) => {
      onTitleChange?.(title);
    });

    const handleResize = () => {
      if (disposedRef.current) return;
      try {
        fitAddon.fit();
      } catch {
        /* ignore */
      }
      const cols = Math.max(term.cols || 80, 80);
      const rows = Math.max(term.rows || 24, 24);
      sendResizeIfChanged(cols, rows);
    };

    window.addEventListener("resize", handleResize);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => handleResize())
        : null;
    resizeObserver?.observe(terminalRef.current);
    const initialResizeTimeout = window.setTimeout(handleResize, 100);

    return () => {
      closingByCleanupRef.current = true;
      disposedRef.current = true;
      window.removeEventListener("resize", handleResize);
      window.clearTimeout(initialResizeTimeout);
      try {
        resizeObserver?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
      } catch {
        /* ignore */
      }
      try {
        ws.close(1000, "component_unmount");
      } catch {
        /* ignore */
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
      decoderRef.current = null;
    };
  }, [
    wsUrl,
    fontSize,
    fontFamily,
    accessibilitySupport,
    theme?.background,
    theme?.foreground,
    theme?.cursor,
  ]);

  return (
    <div
      ref={terminalRef}
      data-testid="jabterm-container"
      data-jabterm-state={state}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: theme?.background ?? "#1e1e1e",
      }}
      onMouseDown={() => {
        try {
          xtermRef.current?.focus();
        } catch {
          /* ignore */
        }
      }}
    />
  );
});

export default JabTerm;
