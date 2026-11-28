---
"everything-dev": patch
---

Opening a persistent PGlite data dir now waits for the database to finish starting and, when the directory was initialized by a different PostgreSQL major, fails with an error naming both majors and the two recovery paths (restore a dump into a fresh data dir, or remove the directory to re-initialize) instead of surfacing `PGlite failed to initialize properly` from the first query. Found while evaluating the `@electric-sql/pglite` 0.4 → 0.6 bump (#978): 0.6.0 bundles PostgreSQL 19 and cannot open a directory written by 0.4.x (PostgreSQL 17).

