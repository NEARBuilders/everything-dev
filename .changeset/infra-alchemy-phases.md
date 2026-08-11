---
"api": minor
"everything-dev": minor
---

Phase 3: Add `[infra]` and `[deploy]` config sections for explicit infrastructure declarations

- **`InfraConfigSchema`** / **`DeployConfigSchema`** in `types.ts` — new Zod schemas for `[infra.database]` (type, schemaMode, dedicated, secret), `[infra.redis]` (enabled, slug), and `[deploy]` (provider, service, redeploy). Added to both `BosConfigInputSchema` and `BosConfigSchema`.
- **Backward compat**: `ci.railway` → `deploy` mapping during extends resolution in `mergeBosConfigWithExtends`. When `[deploy]` is absent but `ci.railway.service` is present, deplo y is derived automatically.
- **Config ordering**: `"infra"` and `"deploy"` added to `BOS_CONFIG_ORDER` (before `"app"`).
- **Infra planner**: `InfraInput` gains optional `infraConfig` field. `allocateDatabases` and `buildDatabaseConfigs` check `infraConfig` first, falling back to convention-based `*_DATABASE_URL` scanning when absent.
- **Shared database**: When `[infra.database]` is declared, a single shared `DATABASE_URL` is provisioned (per-plugin schema isolation via search_path).

Phase 4: Split DatabaseLive into DriverLive + MigrationLive, add Neon WebSocket Pool

- **Layer split**: `DatabaseLive` decomposed into:
  - `DriverLive` — manages driver acquire/release only
  - `MigrationLive` — handles migration apply + drift detection (depends on `DatabaseTag`)
  - `DatabaseLive = Layer.provideMerge(DriverLive(url), MigrationLive)` — composed, backward-compatible
  - Enables skipping migrations when Alchemy manages prod migrations.
- **Neon WebSocket Pool**: `createDatabaseDriver` now checks for `neon.tech` in the URL and uses `@neondatabase/serverless` Pool + `drizzle-orm/neon-serverless` with same `search_path` + `CREATE SCHEMA` support. Gracefully falls back to `pg` Pool if `@neondatabase/serverless` is not installed.
- **Deploy script generation**: `alchemy.ts` with `generateAlchemyRun()` that writes `alchemy.run.ts` from `[deploy]` config, supporting both Railway and Alchemy providers.
- **Dependency**: `@neondatabase/serverless: "^1.0.0"` added to api/package.json.
