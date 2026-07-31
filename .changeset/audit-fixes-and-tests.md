---
"api": patch
"everything-dev": patch
---

Fix bugs and add test coverage for Phase 3+4 infra/alchemy features

- **B1**: Fix typo in `alchemy.ts` generated comment (`[d eploy]` → `[deploy]`)
- **B2**: Fix fire-and-forget schema creation in `db/index.ts` — `pool.on("connect")` handlers now `await` both `CREATE SCHEMA` and `SET search_path` queries in sequence (both Neon and pg paths)
- **B3**: Fix Railway redeploy in `plugin.ts` to read `deploy.service` first, falling back to `ci.railway.service` for backward compatibility
- **S3+S6**: Extract shared pool helpers (`buildPoolConfig`, `attachPoolSchemaHandlers`, `createCloseHandler`) in `db/index.ts` to eliminate ~70% code duplication between Neon WebSocket and pg connection paths
- **S5**: Replace non-idiomatic `throw` with `yield* Effect.fail(...)` in `db/layer.ts` drift handlers

**New tests (15 total)**:
- `merge.test.ts`: 4 tests for `ci.railway` → `deploy` backward compat mapping, plus updated `BOS_CONFIG_ORDER` field assertions for `ci`/`infra`/`deploy`
- `infra.test.ts`: 3 tests for `buildDatabaseConfigs` with `infraConfig` (shared DATABASE_URL, convention fallback, port preservation)
- `tests/e2e/toml-config-pipeline.test.ts`: 8 e2e tests covering the full TOML config pipeline — read full config with `[infra]`/`[deploy]`, path resolution, extends merge, `ci.railway` mapping, shared database config, `generateAlchemyRun` output correctness, and TOML round-trip
