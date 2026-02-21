## Goal

Reach and sustain **99% test coverage** (lines + branches) across:

- `src/server/**` (Node runtime)
- `src/react/**` (client library code)

The coverage badge (`coverage/badge.json`) should represent the **combined** result (“test coverage”), not just server-side instrumentation.

## Current baseline (what we have)

- **Client tests exist**: Playwright E2E exercises the demo page (`tests/react-demo.spec.ts`) and verifies that `jabterm/react` mounts, resizes, and exposes the imperative API in the browser.
- **Server coverage exists**: Node V8 coverage via Playwright-driven Node processes, reported by `c8` for `src/server/**`.
- **Gap**: E2E browser execution does **not** contribute to Node V8 coverage for `src/react/**`, so we need dedicated client-side unit tests to measure and improve coverage there.

## Strategy

### 1) Measure client coverage with unit tests (fast, deterministic)

Add a unit test runner for client code (`vitest` + `jsdom`) and focus on **logic-heavy paths** in `src/react/JabTerm.tsx`:

- **Handshake**: hello + initial resize message
- **Message handling**:
  - string frames (plain output)
  - JSON error frames (`{type:"error"}`)
  - binary frames (TextDecoder path)
- **Imperative API**:
  - `readAll()`, `readNew()`, `getNewCount()`
  - `resize()` clamping + websocket send
  - `paste()` fallback
- **Lifecycle**: cleanup (listeners, websocket close, terminal dispose)

This is where most branch coverage lives, and improving it yields the biggest % gain.

### 2) Keep E2E tests for real integration

Continue using Playwright to validate that:

- the server boots and proxies correctly
- the demo page works in a real browser
- the “closed” UI is shown on exit

E2E is great for confidence, but we rely on unit tests for fine-grained branch coverage.

### 3) Add server unit tests for edge cases (to push from ~95% to 99%+)

Target the remaining uncovered branches in `src/server/**`, typically:

- error paths (invalid inputs, unexpected websocket frames)
- timeouts / shutdown ordering
- proxy validation and header/origin behavior

Prefer small unit tests for helpers (`utils.ts`) and narrow integration tests for `createJabtermServer()` / proxy wiring.

### 4) Enforce and ratchet thresholds

Once coverage is stable:

- introduce a **coverage threshold gate** in CI (start slightly below current, then raise)
- ratchet toward **99%** in small steps (e.g. +0.5% per iteration)

This prevents regressions and keeps the badge meaningful over time.

## Milestones

- **M1 (now)**: Combined badge label “test coverage”; client unit tests + client coverage measurement in CI.
- **M2**: Expand client unit suite to cover error/binary/lifecycle branches in `JabTerm.tsx`.
- **M3**: Add server unit tests for remaining uncovered branches; introduce CI thresholds.
- **M4**: Achieve **99%** and keep it via gating + incremental improvements.

