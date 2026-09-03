# ADR-003 — Code is never summarised; checkpoints are never automatic

**Status:** accepted · 2026-09-03

## Context

Two product rules that turn out to constrain the schema, and one gap between them that
had to be closed before writing any of it.

## Decision

### Code is ground truth

Source code, interfaces and database schemas are stored verbatim in `artifacts` and are
**never** summarised. Summarisation may compress reasoning, argument and dead ends —
never an artifact. A summarised function signature loses its exact names, and the model
then reconstructs them from memory: a hallucination wearing the project's own clothes.

Because artifacts are stored verbatim, bytes are content-addressed: `artifact_blobs` is
keyed by `sha256`, and states reference it. Forty states referencing one file cost one
copy, not forty.

The unavoidable corollary: **artifacts are never auto-attached to a request.** An
unsummarisable 800-line file would consume the entire context budget on its own, so
inclusion is always an explicit choice. Rule 1 without this corollary shows up as "why
did that question cost a dollar".

### Checkpoints are explicit

Summarisation is never triggered by a background job. It runs when the user presses a
checkpoint button, having decided the stage is worth fixing. Anything else silently
spends money on the user's own API key.

### The gap between those two rules

Rule 3 of the concept wants parent branches passed to the model as compressed decisions.
Rule 2 forbids compressing anything unprompted. So: what goes into the context when the
user forks *without* having checkpointed?

Resolved as follows:

- Compression stays strictly opt-in, but the checkpoint is **offered at the moment of the
  fork**, with the estimated token count and cost shown, and dismissible in one click.
- If declined, the un-summarised ancestor is included **truncated** to its most recent N
  messages, and `GET /states/:id/context/preview` states plainly that it was truncated.

Nothing is spent in the background, and no state is left undefined.

### Checkpoints produce Decisions

A checkpoint does not "compress a branch" — it **records a decision**: what was chosen,
why, and what was rejected. That is the `decisions` table, and it is what an ancestor
collapses into when it is passed as memory rather than as focus.

This moves `Decision` out of the far-future phase it was originally planned for and into
the core, because the two-level context model rests on it.

## Consequences

- `artifact_blobs` / `artifacts` split exists from the first migration.
- `decisions` exists from the first migration, even though its UI does not.
- `states.summary_stale` marks a summary invalidated by a newer message; nothing acts on
  the flag until Phase 4, but the column is here so history is not lost meanwhile.
