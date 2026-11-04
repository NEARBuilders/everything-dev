---
"everything-dev": patch
---

Stop the init/sync copy from carrying `*.gen.ts` artifacts into child projects, and make contract-type generation degrade to the `.bos/generated/auth` stubs when auth resolution fails instead of skipping the write. Together these fix child typechecks failing with `TS2307: Cannot find module '.../auth/src/auth-export.ts'` when a stale root-authored `plugins/_template` gen file leaked into the scaffold and a transient auth-registry outage prevented regeneration.
