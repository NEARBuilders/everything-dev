---
"api": patch
"everything-dev": patch
---

Fix remaining TOML config implementation gaps

- **G2**: Add missing `title` and `description` fields to `BosConfigInputSchema` so they are not stripped during Zod validation (previously existed on the TypeScript interface but not the Zod schema)
- **G3**: Handle per-plugin record variant of `[infra.database]` in `buildDatabaseConfigs`. When `database` is a `Record<string, InfraDatabase>` (e.g. `[infra.database.auth]`, `[infra.database.api]`), the function now iterates entries and matches them to `*_DATABASE_URL` secrets instead of treating all truthy database values as a single shared config. Extracted `resolveDatabasePort` and `buildDatabaseConfigFromSecret` helpers to share logic with the convention-based scanning path.
- **G1**: Wire `generateAlchemyRun` into `publish.ts` — after a successful publish, if `bosConfig.deploy` is present, `generateAlchemyRun` is called to write `alchemy.run.ts` with the deploy configuration
- **G4**: Make 22 user-facing error messages format-agnostic (no longer hardcode `"bos.config.json"`). Affected files: `config.ts`, `plugin.ts`, `cli.ts`, `sync.ts`, `shared-deps.ts`, `upgrade.ts`, `dag.ts`
- **G5**: Fix `upgrade.ts` plugin config scanning glob/regex to match both `bos.config.json` and `bos.config.toml`
