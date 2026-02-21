# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-02-21

### Fixed

- Graceful shutdown: close WebSocket clients before killing PTYs to prevent node-pty native crashes on teardown. ([#20](https://github.com/holiber/jabterm/pull/20))
- Make `close()` idempotent under concurrent callers by returning a single shared close promise. ([#20](https://github.com/holiber/jabterm/pull/20))
- CLI: allow `--port 0` to correctly request an ephemeral port. ([#20](https://github.com/holiber/jabterm/pull/20))

