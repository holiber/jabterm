# JabTerm

[![CI](https://github.com/holiber/jabterm/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/holiber/jabterm/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fholiber%2Fjabterm%2Fmain%2Fcoverage%2Fbadge.json)](https://github.com/holiber/jabterm/blob/main/coverage/coverage-summary.json)

**Just Another Browser Terminal** — run your real terminal in browser

<p align="center">
  <a href="docs/demo.webm">
    <img src="docs/demo.gif" alt="JabTerm demo" width="520" style="max-width: 100%;" />
  </a>
</p>


## Features

- Single `<JabTerm>` React component
- Multiple independent terminals on one page without conflicts
- Node.js server powered by `node-pty` — real shell, real colors
- Same-origin WebSocket proxy for HTTPS / Cloudflare / tunnel deployments
- CLI binary: `npx jabterm-server --port 3223`

## Quick Start

### 1. Install

```bash
pnpm add jabterm @xterm/xterm
```

### 2. Start the server

```bash
npx jabterm-server --port 3223
```

Or programmatically:

```typescript
import { createJabtermServer } from "jabterm/server";

const server = createJabtermServer({ port: 3223, host: "127.0.0.1", path: "/ws" });
await server.listen();
// server.address() -> { address, family, port }
// server.close() to shut down deterministically
```

### 3. Render the component

```tsx
import { JabTerm } from "jabterm/react";
import "@xterm/xterm/css/xterm.css";

function App() {
  return (
    <div style={{ width: "100%", height: 400 }}>
      <JabTerm wsUrl="ws://localhost:3223" />
    </div>
  );
}
```

## Local development

```bash
pnpm install
pnpm dev:demo
```

This starts:
- the terminal WebSocket server on `ws://127.0.0.1:3223`
- the demo page on `http://127.0.0.1:3224`

CI also regenerates these assets on pushes to `main` (so contributors typically don't have to).

## API Reference

### `<JabTerm>` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `wsUrl` | `string` | *required* | Full WebSocket URL (`ws://` or `wss://`) |
| `onTitleChange` | `(title: string) => void` | — | Fires when the shell sets a window title |
| `onOpen` | `() => void` | — | Fires when the WebSocket becomes open |
| `onClose` | `(ev: CloseEvent) => void` | — | Fires when the WebSocket closes |
| `onError` | `(ev: Event) => void` | — | Fires on WebSocket errors |
| `captureOutput` | `boolean` | `true` | Capture output for imperative `read*()` methods |
| `maxCaptureChars` | `number` | `200000` | Max captured output size (characters) |
| `className` | `string` | — | CSS class for the outer container |
| `fontSize` | `number` | `13` | Font size in pixels |
| `fontFamily` | `string` | system monospace | Font family |
| `theme` | `{ background?, foreground?, cursor? }` | `{ background: "#1e1e1e" }` | xterm.js theme overrides |

The outer container also exposes `data-jabterm-state="connecting|open|closed"` to make UI tests (e.g. Playwright) wait reliably.

### Imperative API (`JabTermHandle`)

`<JabTerm ref={...} />` exposes:

- `focus()`, `fit()`, `resize(cols, rows)`, `paste(text)`, `send(data)`
- `getXterm()` to access the underlying xterm instance
- `readAll()`, `readLast(n)`, `readNew()`, `getNewCount()` for testing/automation

### `createJabtermServer(options?)`

```typescript
const server = createJabtermServer({
  port: 3223,          // default: 3223 (use 0 for ephemeral)
  host: "127.0.0.1",   // default: 127.0.0.1
  path: "/ws",         // default: "/"
  shell: "/bin/bash",  // default: resolves from $SHELL / OS defaults
  cwd: "/home/user",   // default: $HOME
  env: { FOO: "bar" }, // extra env for spawned PTYs
  strictPort: false,   // default: false — fail if port is busy (ignored for port 0)
});

await server.listen();
console.log(server.address()); // { address, family, port }
```

The WebSocket endpoint supports per-session routing: connect to `${path}/:terminalId` (e.g. `/ws/my-terminal`).

### `setDocumentTitle(title)`

Optional client-side helper:

```ts
import { setDocumentTitle } from "jabterm/react";
```

## Security notes

`jabterm/server` spawns real shell processes. For production deployments:
- Keep it bound to loopback (`127.0.0.1`) and expose only behind an authenticated app/reverse-proxy.
- Consider adding origin checks and/or a token handshake for WebSocket connections.

### `createTerminalProxy(options)`

Creates a `WebSocketServer` in `noServer` mode for same-origin proxying:

```typescript
import { createTerminalProxy } from "jabterm/server";

const proxyWss = createTerminalProxy({
  upstreamUrl: "ws://127.0.0.1:3223",
});

httpServer.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, "http://localhost").pathname === "/ws/terminal") {
    proxyWss.handleUpgrade(req, socket, head, (ws) => {
      proxyWss.emit("connection", ws, req);
    });
  }
});
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for internals

## License

MIT
