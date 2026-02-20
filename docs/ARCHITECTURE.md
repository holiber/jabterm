# JabTerm Architecture

## Overview

JabTerm is published as a single package with two subpath entry points:

- **`jabterm/server`** — Node.js WebSocket server that spawns PTY processes via `node-pty`
- **`jabterm/react`** — React component that renders xterm.js and connects to the server

## Data Flow — Direct Mode

In development or local HTTP setups, the browser connects directly to the terminal server:

```mermaid
sequenceDiagram
    participant Browser
    participant JabTermServer as JabTerm Server<br/>(node-pty + ws)
    participant Shell as Shell Process<br/>($SHELL / bash / zsh)

    Browser->>JabTermServer: WebSocket connect ws://host:3223
    JabTermServer->>Shell: pty.spawn(resolveDefaultShell())
    Note over JabTermServer,Shell: PTY allocated (cols=80, rows=24)

    Browser->>JabTermServer: Binary frame (keystrokes)
    JabTermServer->>Shell: ptyProcess.write(data)
    Shell->>JabTermServer: ptyProcess.onData(output)
    JabTermServer->>Browser: Text frame (terminal output)

    Browser->>JabTermServer: JSON text frame {"type":"resize","cols":120,"rows":30}
    JabTermServer->>Shell: ptyProcess.resize(120, 30)

    Browser->>JabTermServer: WebSocket close
    JabTermServer->>Shell: ptyProcess.kill()
    Note over Shell: Process terminated cleanly
```

## Data Flow — Proxy Mode

For HTTPS, Cloudflare Tunnels, or reverse-proxy setups, the browser connects to the
app server on the same origin, which bridges to the local terminal server:

```mermaid
sequenceDiagram
    participant Browser
    participant AppServer as App Server<br/>(your HTTP server)
    participant Proxy as createTerminalProxy<br/>(WebSocketServer)
    participant JabTermServer as JabTerm Server<br/>(node-pty + ws)

    Browser->>AppServer: Upgrade wss://host/ws/terminal
    AppServer->>Proxy: handleUpgrade(req, socket, head)
    Proxy->>JabTermServer: WebSocket connect ws://127.0.0.1:3223
    Note over Proxy,JabTermServer: Bridge established

    Browser->>Proxy: Binary frame
    Proxy->>JabTermServer: Forward frame
    JabTermServer->>Proxy: Terminal output
    Proxy->>Browser: Forward frame

    Browser->>Proxy: Close
    Proxy->>JabTermServer: Close
```

## Protocol

JabTerm uses a simple multiplexed protocol over a single WebSocket connection:

### Frame Types

| Direction | Frame Type | Content | Purpose |
|-----------|-----------|---------|---------|
| Client -> Server | Binary | Raw bytes | Terminal input (keystrokes) |
| Client -> Server | Text (JSON) | `{"type":"resize","cols":N,"rows":N}` | Resize PTY |
| Server -> Client | Text | Raw terminal output | Display in xterm.js |

### Control Message Detection

The server uses a heuristic: if a text frame starts with `{`, it attempts to parse it as JSON.
If parsing succeeds and `type === "resize"`, it is treated as a control message.
Otherwise, the frame is written to the PTY as input.

### Resize Safety

Minimum dimensions are enforced (`cols >= 10`, `rows >= 10`) to prevent shell crashes from
zero-dimension resize calls.

## Component Lifecycle

```mermaid
flowchart TD
    Mount["Component mounts"] --> CreateTerm["Create Terminal instance"]
    CreateTerm --> LoadFit["Load FitAddon"]
    LoadFit --> OpenTerm["term.open(container)"]
    OpenTerm --> FitSize["fitAddon.fit()"]
    FitSize --> ConnectWS["new WebSocket(wsUrl)"]
    ConnectWS --> WsOpen["ws.onopen"]
    WsOpen --> SendResize["Send resize JSON"]
    WsOpen --> Ready["Terminal ready"]

    Ready --> OnData["term.onData -> ws.send(binary)"]
    Ready --> OnMessage["ws.onmessage -> term.write()"]
    Ready --> WindowResize["window.resize -> fitAddon.fit() + send resize"]

    Unmount["Component unmounts"] --> DetachHandlers["Detach WS handlers"]
    DetachHandlers --> CloseWS["ws.close(1000)"]
    CloseWS --> DisposeTerm["term.dispose()"]
```

## Graceful Shutdown

The server tracks all spawned PTY processes in a `Set<IPty>`.

On `SIGTERM` / `SIGINT`:
1. All tracked PTY processes are killed
2. The WebSocket server is closed
3. A 2-second fallback `setTimeout` ensures the process exits even if `wss.close()` hangs

This prevents zombie shell processes when the server is stopped (e.g., during CI teardown
or when Playwright finishes tests).

## Proxy Bridge Details

`createTerminalProxy()` returns a `WebSocketServer` in `noServer` mode. The caller is
responsible for routing HTTP upgrade requests to it.

The bridge:
- Buffers up to 100 frames while the upstream connection is still `CONNECTING`
- Replays buffered frames once upstream reaches `OPEN`
- Mirrors `close` and `error` events in both directions
- Normalizes WebSocket close codes (strips reserved codes like 1005, 1006, 1015)
- Truncates close reasons to 123 bytes (WebSocket spec limit)
