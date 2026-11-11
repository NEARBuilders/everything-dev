---
"everything-dev": minor
---

Regression harness runs on wiped file-backed pglite dirs — seed-phase integration

`.env.test`'s in-memory pglite marker now substitutes per-workspace pglite dirs
under `.bos/regression/db` (absolute paths; start-stack wipes the root per run),
because an in-memory database cannot be seeded — nothing exists before its
service process creates it, so the pre-spawn seed phase (#866) had nothing to
address. A wiped dir keeps in-memory's isolation while opening the pre-spawn
window: **apps that declare a `seed` block get it applied on every regression
boot automatically**, which is also the migration path off direct-DB seed
helpers and the postgres service containers they force. Explicit database URLs
(postgres or custom pglite dirs) still pass through untouched, and dev-root
URLs stay refused.
