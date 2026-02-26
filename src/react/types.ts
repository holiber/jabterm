import type { Terminal } from "@xterm/xterm";

export type JabTermState = "connecting" | "open" | "closed";

export interface WriteAndWaitOptions {
  /**
   * Resolve after this many ms of silence (no new output).
   * Used only when neither `waitFor` nor `waitForCommand` is set.
   *
   * Default: 300
   */
  quietMs?: number;
  /** Overall timeout in ms. Default: 30_000 */
  timeout?: number;
  /** Resolve once this substring appears in captured output. */
  waitFor?: string;
  /** Resolve on the next `commandEnd` event (requires server shell integration). */
  waitForCommand?: boolean;
}

export interface WriteAndWaitResult {
  output: string;
  exitCode?: number;
}

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
  /** Returns the last command exit code observed via shell integration. */
  getLastExitCode(): number | null;
  /** Resolves with the next command exit code observed via shell integration. */
  waitForCommandEnd(timeoutMs?: number): Promise<number>;
  /**
   * Send input and wait for completion conditions.
   *
   * The returned `output` contains only data received after the call begins.
   */
  writeAndWait(
    input: string | Uint8Array | ArrayBuffer,
    options?: WriteAndWaitOptions,
  ): Promise<WriteAndWaitResult>;
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
  /** Fires for each chunk of output received from the server. */
  onData?: (data: string) => void;
  /** Fires when the underlying PTY exits (before the WebSocket closes). */
  onExit?: (exitCode: number, signal: number | null) => void;
  /** Fires when shell integration reports a command exit code. */
  onCommandEnd?: (exitCode: number) => void;
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
  /**
   * xterm.js accessibility support mode.
   *
   * When set to `"on"`, xterm populates the accessibility tree (and in many setups
   * also makes `.xterm-rows` contain textual content), which is useful for UI
   * testing/automation that reads terminal output from the DOM.
   */
  accessibilitySupport?: "on" | "off" | "auto";
  /** xterm.js theme overrides. */
  theme?: {
    background?: string;
    foreground?: string;
    cursor?: string;
  };
}
