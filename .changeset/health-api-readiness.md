---
"host": patch
---

Report truthful API readiness from `/api/_health`.

The health endpoint previously hardcoded `status: "ready"`, so it reported ready even when the API plugin failed to load (e.g. its database was unreachable), which surfaced as confusing 503s on every `/api/*` route. `getHealthStatus` now derives the effective status from the plugin result:

- `ready` only when the API router is mounted and `plugins.status.available` is true
- `degraded` when the API plugin failed to load
- `failed` when the loading state is marked failed

This makes regression readiness checks fail with a clear signal instead of deep 503 failures.