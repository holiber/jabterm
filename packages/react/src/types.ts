export interface JabTermProps {
  /** Full WebSocket URL, e.g. ws://localhost:3223 or wss://example.com/ws/terminal */
  wsUrl: string;
  /** Fires when the shell sets a title (via escape sequence). */
  onTitleChange?: (title: string) => void;
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
