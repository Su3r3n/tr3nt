# ADR-002 — Lazy ancestor chain, and forking from any message

**Status:** accepted · 2026-09-03

## Context

The one decision that is expensive to reverse: how a branch inherits its parent's
context. Three options were on the table.

| Option | Cost of a fork | Problem |
|---|---|---|
| Copy the parent's messages into the child | O(n) | The same message exists N times; token counts and edits diverge |
| **Lazy ancestor chain** | **O(1)** | Every read walks the tree |
| Event log with projections | O(1) | An extra layer with no payoff for one developer |

## Decision

**A state stores only its own messages.** Context is assembled at request time by walking
up `parent_id`. Forking is a single INSERT and never writes to the parent.

**`states.branch_point_seq` is load-bearing.** It records the sequence number in the
*parent* at which this branch forked. When assembling context, an ancestor contributes
only messages with `seq <= cutoff`, where the cutoff is the `branch_point_seq` of the
child we descended through.

Without this column, "fork from any message" would create the branch correctly and then
quietly hand the model everything that came after the fork point — the branch would look
right and behave exactly like the poisoned context it was meant to escape. The failure
would surface as "the model keeps bringing up the thing I moved away from", which is
almost impossible to diagnose from the outside.

`branch_point_message_id` is a convenience pointer, deliberately **without** a foreign
key, because `states -> messages -> states` would be a circular dependency in DDL. The
seq is the source of truth.

There is no `projects.root_state_id` for the same reason. The root is the single state
with `parent_id IS NULL`, enforced by a partial unique index.

## Invariants (all covered by `test/state-tree.spec.ts`)

1. Exactly one root per project.
2. A branch always has a parent, a fork point and depth > 0 (`states_shape` check).
3. Forking leaves the parent row and its messages byte-identical.
4. A fork from message *k* sees the parent's messages 1..*k* and nothing after.
5. Sibling branches never see each other.
6. Message `seq` is per state, starts at 1, and survives concurrent appends.
7. No branch may be taken from a message that is still `streaming`.

## Consequences

- Reads cost a recursive CTE. At the scale of a personal project this is free; if it ever
  is not, a materialised path is the fix and it is additive.
- Deleting a state cascades down the subtree by foreign key.
- Merge (a state with two parents) would make this a DAG rather than a tree. It is
  deliberately **not** modelled yet: many-to-many parents complicate every traversal, and
  merge can be added later as a join table without touching this decision.
