# TR3NT

A tree-shaped AI workspace. Instead of one linear chat that has to be rolled back —
destroying everything after the rollback point — every decision point becomes a state you
can branch from, return to, and compare against its siblings.

The unit of the system is a **State**, not a message.

```
project
└── root ──────────── msg 1, msg 2, msg 3, msg 4, msg 5
     ├── pgvector ── forked at msg 2 → sees msg 1–2, then its own
     └── qdrant ──── forked at msg 2 → sees msg 1–2, then its own
```

Branching is one INSERT and never touches the parent. A branch sees its own messages plus
the *pre-fork prefix* of each ancestor — never a sibling, never what the parent said after
the fork. See [ADR-002](docs/adr/002-state-tree-and-forking.md).

## Status

Phase 1 of 8: the state tree, with no LLM attached yet. Deliberately — a tree defect is
much easier to find when nothing in the system is non-deterministic.

- [x] **P0** repository, Postgres, migrations, lint/types/tests
- [x] **P1** project → root state → branches, fork from any message, tree, context assembly
- [x] **P2** Gemini provider, SSE streaming, usage accounting
- [ ] **P2.5** thin web client (three panes: tree, state, chat)
- [ ] **P3** Context Engine with a hard token budget
- [ ] **P4** explicit checkpoints → Decisions
- [ ] **P5** retrieval over messages, decisions and documents
- [ ] **P6** cost accounting and prompt caching
- [ ] **P7** Tauri desktop shell

## Running it

Requires Node 22+ and Docker.

```bash
cp .env.example .env
docker compose up -d          # Postgres 16 with pgvector, on 127.0.0.1:5432
npm install
npm run db:migrate
npm run dev                   # http://127.0.0.1:3777
```

Tests need neither Docker nor a running database — they boot Postgres compiled to WASM:

```bash
npm test          # ~4s
npm run typecheck
npm run lint
```

## API

| | | |
|---|---|---|
| `POST` | `/projects` | creates the project and its root state together |
| `GET` | `/projects` | |
| `GET` | `/projects/:id/tree` | the whole tree, nested, with message counts |
| `GET` | `/projects/:id/root` | |
| `DELETE` | `/projects/:id` | cascades to states and messages |
| `GET` | `/states/:id` | |
| `POST` | `/states/:id/branch` | `{ title, fromMessageId? }` — omit the id to fork from the tip |
| `PATCH` | `/states/:id` | `{ title?, status? }` — `abandoned` keeps dead experiments out of the way |
| `GET` | `/states/:id/messages` | |
| `POST` | `/states/:id/messages` | |
| `GET` | `/states/:id/context/preview` | **exactly what the model would be given, and why** |

`/context/preview` is not for the end user. A bad context is indistinguishable from a dim
model until you can read the assembled prompt, so it exists before there is anything to
send it to.

### A branch in four calls

```bash
BASE=http://127.0.0.1:3777

PROJECT=$(curl -sX POST $BASE/projects -H 'Content-Type: application/json' \
  -d '{"name":"PubMed RAG","rootTitle":"architecture"}')
ROOT=$(echo "$PROJECT" | python -c 'import json,sys;print(json.load(sys.stdin)["rootState"]["id"])')

curl -sX POST $BASE/states/$ROOT/messages -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"we need a vector database"}'

curl -sX POST $BASE/states/$ROOT/branch -H 'Content-Type: application/json' \
  -d '{"title":"pgvector"}'

curl -s $BASE/states/$ROOT/context/preview
```

## Layout

```
src/
  domain/      pure logic — no database, no Nest, no HTTP
  db/          Drizzle schema, migrations, driver wiring
  modules/     services and controllers per aggregate
  common/      domain errors and their HTTP mapping
docs/adr/      why things are the way they are
test/          invariants, against a real Postgres in WASM
```

Domain errors carry their own HTTP status but import nothing from `@nestjs/*`, so the
same services can be driven from a CLI, a test, or the desktop process later.

## Decisions worth reading before changing anything

- [ADR-000 — Stack](docs/adr/000-stack.md): why Drizzle replaced Prisma, why not Python
- [ADR-001 — Local daemon](docs/adr/001-local-daemon.md): why there is no authentication
- [ADR-002 — State tree](docs/adr/002-state-tree-and-forking.md): `branch_point_seq`, and why it is load-bearing
- [ADR-003 — Code is ground truth](docs/adr/003-code-is-ground-truth.md): what is never summarised, and when

## The question to ask before adding anything

> Does this help explore alternative solutions and move between states, with the context
> under control?

If not, it is not a priority for this version, however interesting it is.
