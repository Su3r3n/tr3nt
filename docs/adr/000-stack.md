# ADR-000 — Stack

**Status:** accepted · 2026-09-03

## Context

The project is a personal engineering sandbox, backend-first. The endgame is a Tauri
desktop client. The technically hardest phase is not the tree but Phase 5 (retrieval),
and the whole product is meant to be dogfooded, not shipped to customers.

## Decision

- **NestJS 11 + TypeScript.** Modular structure familiar from Spring, first-class SSE.
- **PostgreSQL 16** in Docker, `pgvector/pgvector:pg16` so Phase 5 needs no migration.
- **Drizzle ORM**, not Prisma.
- **PGlite** (Postgres compiled to WASM) for tests.
- One language across backend, web client and desktop.

## Why not Python

Python has the better retrieval ecosystem, and that was the original recommendation. It
lost on the endgame: bundling a Node backend into a Tauri sidecar is a build flag, while
bundling Python is an evening with PyInstaller. Retrieval experiments (chunking sweeps,
recall measurement, reranker comparison) will be run as throwaway Python scripts against
the same database — an analyst's notebook, not a second production stack.

## Why not Prisma

Prisma was the first choice and was reversed. Postgres was picked for `pgvector` and for
recursive graph queries; Prisma supports neither natively. Vectors become
`Unsupported(...)` and recursive CTEs become `$queryRaw` — so Prisma would have covered
plain CRUD and fallen away at exactly the two operations the product is built on.
Drizzle gives the same migrations and type safety without standing between us and SQL.

## Consequences

- Raw SQL is expected and normal in this codebase, confined to repository/service methods.
- `db.execute()` returns different shapes per driver, normalised once in `src/db/raw.ts`.
- Decorator metadata is emitted by `tsc` for production; tests instantiate services
  directly, so esbuild's lack of `emitDecoratorMetadata` never bites. Keep DI tokens
  explicit (`@Inject(DRIZZLE)`) rather than type-based, and it stays that way.
