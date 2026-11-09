---
"everything-dev": patch
---

Fix the production plugin-boot outage from the #811 ahead-of-build journal guard: every shared-DB workspace (api + all plugins falling back to `API_DATABASE_URL`) failed to load with `unknown failure` on every boot.

**Root cause (two stacked bugs):**

1. The guard treated any `drizzle.__drizzle_migrations` row the build doesn't know as "a newer build migrated this DB" and failed boot. But the journal is intentionally shared by every workspace on one database (data tables are `plugin_<slug>`-schema isolated; the journal is not), and journal rows carry no workspace attribution — so sibling plugins' rows always look "unknown", and the guard fired 100% of the time for every shared workspace. auth (dedicated DB) and the non-DB plugins were the only survivors.
2. The guard's error formatter crashed before it could fail cleanly: journal `created_at` is `bigint`, node-postgres delivers int8 as a **string**, and `new Date("1730...").toISOString()` throws `RangeError: Invalid time value` — the "unknown failure" every plugin surfaced. Dev never caught it because pglite typing differs.

**Fix:** `readJournalRowsIn` now coerces `created_at` at the read seam (string/number → finite number, else `null`), and the unknown-row check is **advisory** (logged warning with hashes + timestamps, boot proceeds) until per-workspace journals land and the check becomes sound. `BOS_ALLOW_SCHEMA_AHEAD` is removed — it shipped with #811 and has no meaning under the advisory check.
