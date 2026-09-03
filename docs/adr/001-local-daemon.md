# ADR-001 — TR3NT is a local daemon, not a hosted service

**Status:** accepted · 2026-09-03

## Context

The backend needs a client. A web UI comes before the desktop shell, which raises a
question that looks like deployment but is actually product scope: where does the
backend run, and who holds the API key?

## Decision

The backend binds to `127.0.0.1` and serves a single user with **no authentication**.
The provider API key lives in the backend process (OS keyring from Phase 2; the database
stores only a reference). The web client and, later, the Tauri shell are both clients of
the same loopback API.

## Consequences

- No auth, no tenancy, no per-user key encryption — none of it is needed, so none of it
  is built.
- Tauri bundles this backend as a sidecar. The security model does not change on the way
  to desktop, which is the point.
- **Deploying this to a server is not a configuration change, it is a different product.**
  It would require authentication, per-user isolation and encrypted storage of other
  people's keys. If that is ever wanted, it gets its own ADR and its own phase.
- `HOST` is configurable, but changing it away from loopback without doing the above is
  a security bug, not a feature. This is why `main.ts` says so at the binding site.
