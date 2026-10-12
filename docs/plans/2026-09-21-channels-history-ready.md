# Channels History Readiness Implementation Plan

**Goal:** Initialize message history independently of extension startup order, with accurate failures and session-scoped cleanup.

**Architecture:** Subscribe to `kysely:ready` before probing `kysely:info`, require the named default database to exist, and launch initialization without awaiting it from `session_start`. Publish history to consumers only after initialization succeeds. Register tools with a live history getter so late initialization and shutdown do not leave captured stale instances.

**Tech Stack:** TypeScript, Pi event bus, Node test runner (Node 24 native TypeScript and module mocks).

## Evidence and alternatives

Pi 0.86.1 `dist/core/extensions/runner.js:650` awaits each handler sequentially. Kysely registers info/query listeners during factory evaluation, but creates the default database in session_start. Both info and ready can contain an empty registry. Query failures invoke ack rather than reply.

Awaiting a validated ready event still blocks later startup handlers. Moving Kysely database creation to its factory broadens scope and changes resource ownership. Prefer consumer-side, session-scoped background initialization as requested in the handoff; no Kysely changes needed.

## Steps (execute directly, no delegation)

1. Add `extensions/pi-channels/test/history.test.mjs` and `startup.test.mjs`. Mock only configuration (no production settings/network), model sequential lifecycle dispatch and Kysely's existing info/query/ack contract. Verify failures before implementation with `npm test`.
2. Update `history.ts`: immediate ack errors, settle-once query cleanup, disposal that cancels pending waits and prevents subsequent SQL from stale initialization.
3. Real Kysely integration additionally exposed raw DDL being rejected as table `IF` by the DML RBAC parser and unregistered history ownership. Route DDL through `kysely:migration:apply`, then declare ownership via `kysely:schema:register` on every session. Preserve original tables/data/constraints. Cover existing legacy data and repeated initialization in `integration/history-kysely.mjs`; no shared RBAC changes.
4. Add `history-lifecycle.ts`: validated readiness probe/listener, single in-flight initialization, timeout warning without giving up on later readiness, unsubscribe/dispose on stop. Include the file in package.json.
5. Update `index.ts`, `registry.ts`, and `tool.ts`: background initialization, synchronized publication/clearing, live tool getter. Verify both orders, empty/nondefault registry, failed/missing provider, repeated events, retry after failure, shutdown and new session.
6. Run channels tests/typecheck and Kysely baseline tests/typecheck where feasible. Review diff, document activation and limitations in README. Commit, push, open PR, update Hub and td. Do not merge or restart.

## Acceptance and limits

No load-order assumptions or retry delays. A readiness watchdog is diagnostic only, not a startup wait or polling retry. Late messages are recorded only after schema initialization (no startup buffering). Disposing cancels local waits; SQL already submitted to Kysely cannot be recalled by its current API. Non-SQLite history portability is outside this fix.
