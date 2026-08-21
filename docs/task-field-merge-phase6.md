# Task field merge — Phase 6 evidence

Issue: #399

This phase establishes the canonical Core and Mobile Gateway semantics for field-level Task patches. It does not close #399.

## Semantics

- `UpdateTask` may include a `base` patch with exactly the same fields as `changes`.
- If the expected Task version is stale but every changed field still equals its base value, Core retries the command against the current canonical version.
- Changes made concurrently to other fields are preserved.
- If the same field differs from both the base and intended value, Core returns `version_conflict` with the current canonical Task.
- Mobile Gateway exposes a title-only `UpdateTask` envelope in this slice and maps the canonical conflict to HTTP 409 with `intendedAction: UpdateTask`.
- Commands without `base` retain strict expected-version behavior.

## Automated evidence

- Task capability test: a stale title patch merges over a concurrent priority change and preserves both values.
- Task capability test: a stale title patch conflicts after a concurrent title change and returns the canonical title.
- Mobile Gateway test: the same auto-merge and same-field 409 behavior crosses the public Mobile contract.
- TypeScript typecheck and focused Task/Mobile Gateway tests pass.

## Remaining boundary

Android Room/outbox title editing, conflict persistence, explicit local/server resolution, Compose editing, and S23 device evidence remain a separate vertical slice before #399/#400 acceptance.
