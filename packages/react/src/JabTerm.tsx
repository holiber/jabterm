"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { JabTermProps } from "./types.js";

const DEFAULT_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export default function JabTerm({
  wsUrl,
  onTitleChange,
  className,
  fontSize = 13,
  fontFamily = DEFAULT_FONT_FAMILY,
  theme,
}: JabTermProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const closingByCleanupRef = useRef(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    if (!terminalRef.current) return;
    closingByCleanupRef.current = false;
    disposedRef.current = false;

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
      if (disposedRef.current || closingByCleanupRef.current) return;
      term.write(
        `\r\n\x1b[31mConnection closed (code ${e.code})\x1b[0m\r\n`,
      );
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
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const cols = Math.max(term.cols || 80, 80);
        const rows = Math.max(term.rows || 24, 24);
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };

    window.addEventListener("resize", handleResize);
    setTimeout(handleResize, 100);

    return () => {
      closingByCleanupRef.current = true;
      disposedRef.current = true;
      window.removeEventListener("resize", handleResize);
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
    };
  }, [wsUrl, fontSize, fontFamily, theme?.background, theme?.foreground, theme?.cursor]);

  return (
    <div
      ref={terminalRef}
      data-testid="jabterm-container"
      className={className}
      style={{ width: "100%", height: "100%", overflow: "hidden", background: theme?.background ?? "#1e1e1e" }}
      onMouseDown={() => {
        try {
          xtermRef.current?.focus();
        } catch {
          /* ignore */
        }
      }}
    />
  );
}
