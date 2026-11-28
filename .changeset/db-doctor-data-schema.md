---
"everything-dev": patch
---

`bos db doctor` resolves the workspace's data schema per topology — `plugin_<slug>` for plugin workspaces (the v2 namespace the runtime driver scopes pooled connections to and `runMigrations`/`detectDrift` check via their `schemaName` parameter), `public` for the api shell and auth — instead of hard-coding `table_schema = 'public'` in the missing-tables query. A v1 per-plugin database (tables in `public`, journal present) now reports `drift-safe-repair` — matching the boot failure it actually produces — instead of a false `healthy`, and a healthy consolidated database (tables in `plugin_<slug>`) is no longer misreported as drifted, which invited a destructive repair. The report carries the checked schema as `dataSchema`, rendered in `bos db doctor` output. Fixes #663.
