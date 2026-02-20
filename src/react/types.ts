import type { Terminal } from "@xterm/xterm";

export type JabTermState = "connecting" | "open" | "closed";

export interface JabTermHandle {
  focus(): void;
  fit(): void;
  resize(cols: number, rows: number): void;
  paste(text: string): void;
  send(data: string | Uint8Array | ArrayBuffer): void;
  getXterm(): Terminal | null;
  /** Returns the entire captured output buffer. */
  readAll(): string;
  /** Returns the last N lines from the captured output buffer. */
  readLast(lines: number): string;
  /** Returns only output received since the last readAll/readNew call. */
  readNew(): string;
  /** Returns the character count of unread output since last readAll/readNew. */
  getNewCount(): number;
}

export interface JabTermProps {
  /** Full WebSocket URL, e.g. ws://localhost:3223 or wss://example.com/ws/terminal */
  wsUrl: string;
  /** Fires when the shell sets a title (via escape sequence). */
  onTitleChange?: (title: string) => void;
  /** Fires when the WebSocket reaches OPEN. */
  onOpen?: () => void;
  /** Fires when the WebSocket closes (including errors). */
  onClose?: (ev: CloseEvent) => void;
  /** Fires on WebSocket errors. */
  onError?: (ev: Event) => void;
  /**
   * Capture terminal output into an internal buffer so imperative `read*()`
   * methods can be used for testing/automation.
   *
   * Default: true
   */
  captureOutput?: boolean;
  /** Max captured output size in characters. Default: 200_000 */
  maxCaptureChars?: number;
  /** CSS class name for the outer container div. */
  className?: string;
  /** Font size in pixels. Default: 13 */
  fontSize?: number;
  /** Font family. Default: system monospace stack */
  fontFamily?: string;
  /** xterm.js theme overrides. */
  theme?: {
    background?: string;
    foreground?: string;
    cursor?: string;
  };
}
