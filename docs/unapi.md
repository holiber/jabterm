# Unapi (Contract)

This document defines the **Unapi principles**, naming rules, and invariants.
If something conflicts with this doc, this doc wins.

Unapi exists to define an API **once** and derive everything else:
typed client, CLI, HTTP, MCP, OpenAPI, and (future) streaming/events specs.

---

## Core idea

A procedure is a small, declarative unit:

- **id**: stable canonical identifier
- **schemas**: input/output validation (runtime)
- **types**: inferred from schemas (compile-time)
- **meta**: description/tags for docs and derived surfaces
- **handler**: implementation

Everything else is derived from procedure definitions.

---

## Canonical procedure IDs

### Format

`<resource>.<action>`

Rules:

- Use dot-separated namespaces: `board.create`
- Prefer **singular** resource names: `board`, `column`, `card`
- Prefer stable verbs: `get | list | create | update | delete | move`
- Do not embed transport details in IDs (no `...Http`, `...Cli`, etc.)
- IDs are public contract: changing an ID is a breaking change unless aliased.

### Why IDs matter

Canonical IDs are used as the identity for:

- router dispatch keys
- typed client nesting keys
- CLI command rendering
- OpenAPI operationIds
- MCP tool IDs (or names)

---

## Router contract

A Router must:

1) register procedures by canonical `id`
2) validate input using the input schema before calling the handler
3) validate output using the output schema before returning it
4) expose a `describe()` method for tooling (CLI/MCP/OpenAPI)
5) support aliases (optional) but always prefer canonical IDs

### Describe output (minimum)

`describe()` should return enough info to generate:

- CLI commands + help
- OpenAPI operations
- MCP tools
- client typings

Minimum fields per procedure:

- `id`
- `meta.description`
- `meta.tags` (optional)
- input schema shape (or a JSONSchema equivalent)
- output schema shape (or a JSONSchema equivalent)

---

## Client contract

The client must be derived from router procedures.

### Required client shape

The preferred shape is **nested**, derived by splitting `id` by `.`:

- `board.create` → `client.board.create(...)`
- `card.move` → `client.card.move(...)`

A flat variant is optional for compatibility:

- `client["board.create"](...)`

### Deterministic mapping

- Nesting is purely mechanical from the ID split
- No special casing per procedure
- If an ID segment conflicts with a reserved word, handle it consistently
  (either escape it or keep a flat-only alias), and document it.

---

## Transport contract (thin wrappers)

All transports are adapters over the same router.

### HTTP

- HTTP should dispatch by procedure `id`
- URL style may vary (examples):
  - `/api/call/board.create`
  - `/api/call/board/create`
- Regardless of URL style, the canonical identity is the procedure `id`

### CLI

- CLI commands must be derived from the same procedure list
- Rendering rule (recommended):
  - `board.create` → `board create`
- Command help text must use `meta.description`

### OpenAPI

- Operation identity MUST be the canonical `id`
- Recommended mapping:
  - `operationId = id`
  - `tags = [resource]` (or from `meta.tags`)
  - path is derived from transport mapping, but must remain stable

### MCP

- Tools/resources/prompts must be derived from the same procedures
- Tool ID/name should match canonical `id` (or a stable transformation)
- Tool descriptions must use `meta.description`

---

## Validation and type-safety rules

- Zod schemas (or equivalent) are the source of truth for runtime validation.
- TypeScript types must be inferred from schemas.
- Never duplicate schema definitions and TS types manually.

Required behavior:

- input is validated before handler execution
- output is validated before returning
- errors are surfaced consistently across transports

---

## Compatibility and aliases

Aliases are allowed to ease migration, but they must follow rules:

- Aliases map legacy names → canonical IDs
- Docs must always show canonical IDs
- Derived surfaces may include aliases as additional commands/paths, but:
  - canonical must remain the primary
  - alias behavior must be explicit and test-covered
  - alias removal must be planned and documented

---

## What counts as a “smart” new Unapi concept

If you add a concept to Unapi, it should:

- reduce duplication across transports
- improve determinism (less “magic”)
- preserve or improve typing and validation
- be documented in this file
- be testable with small unit tests

Smells to avoid:

- transport-specific logic in domain code
- hand-written OpenAPI/CLI commands that drift from procedures
- dynamic behavior that cannot be described in `describe()`

---

## Checklist for refactors and new features

Before merging:

- [ ] Procedure IDs follow `<resource>.<action>`
- [ ] Client nesting works for all procedures
- [ ] HTTP dispatch works for all procedures
- [ ] CLI commands are generated and usable
- [ ] OpenAPI generation uses stable operationIds
- [ ] MCP tooling is derived from the same source (if present)
- [ ] `pnpm test:smoke` passes (at minimum)
- [ ] `pnpm test` passes for non-trivial changes
- [ ] Docs updated if any public surface changed
