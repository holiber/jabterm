"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { JabTermHandle, JabTermProps, JabTermState } from "./types.js";

const DEFAULT_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

const JabTerm = forwardRef<JabTermHandle, JabTermProps>(function JabTerm(
  {
    wsUrl,
    onTitleChange,
    onOpen,
    onClose,
    onError,
    className,
    fontSize = 13,
    fontFamily = DEFAULT_FONT_FAMILY,
    theme,
  },
  ref,
) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closingByCleanupRef = useRef(false);
  const disposedRef = useRef(false);
  const [state, setState] = useState<JabTermState>("connecting");

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
        const ws = wsRef.current;
        if (!term) return;
        const safeCols = Math.max(cols || 80, 10);
        const safeRows = Math.max(rows || 24, 10);
        try {
          term.resize(safeCols, safeRows);
        } catch {
          /* ignore */
        }
        if (ws?.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "resize", cols: safeCols, rows: safeRows }));
          } catch {
            /* ignore */
          }
        }
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
    }),
    [],
  );

  useEffect(() => {
    if (!terminalRef.current) return;
    closingByCleanupRef.current = false;
    disposedRef.current = false;
    setState("connecting");

    const term = new Terminal({
      cursorBlink: true,
      fontFamily,
      fontSize,
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
      fitAddon.fit();
      const cols = Math.max(term.cols || 80, 80);
      const rows = Math.max(term.rows || 24, 24);
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (event) => {
      if (disposedRef.current) return;
      if (typeof event.data === "string") {
        term.write(event.data);
      } else {
        term.write(new Uint8Array(event.data as ArrayBuffer));
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

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    term.onTitleChange((title) => {
      onTitleChange?.(title);
    });

    const handleResize = () => {
      if (disposedRef.current) return;
      try {
        fitAddon.fit();
      } catch {
        /* ignore */
      }
      if (ws.readyState === WebSocket.OPEN) {
        const cols = Math.max(term.cols || 80, 80);
        const rows = Math.max(term.rows || 24, 24);
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
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
    };
  }, [wsUrl, fontSize, fontFamily, theme?.background, theme?.foreground, theme?.cursor]);

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
