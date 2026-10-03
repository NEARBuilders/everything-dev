---
"everything-dev": patch
---

Remove deploy lock feature and add `bos infra export` command.

- Removed `bos deploy lock acquire/release/inspect` commands and FastKV-backed deploy lock logic. Concurrent deploys now follow last-write-wins semantics (harmless redundancy for Railway redeploy).
- `bos infra export [--target ci|local] [--network mainnet|testnet]` emits `{env, services, account, gateway, project, generatedAt}` JSON. The deploy workflow consumes this to populate `$GITHUB_ENV` instead of repeating `API_DATABASE_URL`, `AUTH_DATABASE_URL`, and `CORS_ORIGIN` literals. Host port comes from `BOS_CI_HOST_PORT` env or `runtimeConfig.host.port`.
- `buildOriginMap` now derives plugin origins from `runtimeConfig.plugins[id].extendsRef` / `runtimeConfig.auth?.extendsRef` (already populated by `loadResolvedConfig`), removing the duplicate raw-JSON read and the parent-runtime fallback logic.
- New tests cover the CI plan builder and the resolved-config origin lookup.
