# Plan 017: The database layer lands in `everything-dev/db` (db helpers + workspace adoption + sync exit)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Design doc**: [plans/v1-current/every-plugin-db-auth-absorption.md](../plans/v1-current/every-plugin-db-auth-absorption.md)
> (decisions D1–D6; the amendment history explains why the home is
> `everything-dev/db`, not `every-plugin/db`).
> **Supersedes**: the original 017/018/019 trio from the first #89 decision
> (every-plugin facades) — rejected in the 2026-09-15 amendment.
> **Timing**: executes inside the effect-native-plugins Phase 4 window (same
> files, one churn, one redeploy).

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 008 (its consolidated runner is consumed here); effect-native-plugins Phase 4 (soft — same window, coordinate file ownership)
- **Category**: product direction (ticket #89, amended)
- **Planned at**: 2026-09-15, post #89 amendment

## Why this matters

Every DB-backed workspace still carries copy-pasted driver selection (~73–130 lines),
db layers (~42–91 lines), and migration runners (~88–450 lines) with three slug
normalizers, three journal conventions, and a shared 25P02 aborted-transaction bug. The
amended design collapses all of it into four exports in `everything-dev/db`
(`pluginSchemaName`, `createDatabaseDriver`, `databaseLayer`, `runMigrations`) with one
namespace concept covering shared-DB schema isolation (postgres/PGlite), public schema
(api), dedicated DB (auth), and a future per-plugin-file SQLite expression.

## Steps

1. **008 lands first** — the consolidated migration runner (SAVEPOINT duplicate
   tolerance, retryable SQLSTATEs, hash journal) is the foundation; this plan consumes
   `runMigrations` and does not fork it.
2. **`everything-dev/db` gains the runtime exports** (`packages/everything-dev/src/db/`):
   - `createDatabaseDriver(url, { namespace?, schema })` — engine by URL scheme
     (`postgres://` → pg.Pool; `pglite:`/`:memory:` → PGlite dir-or-memory), namespace →
     `CREATE SCHEMA plugin_<slug>` + `search_path` (pg/pglite). Drivers via dynamic
     `import()` only; `drizzle-orm` as `import type` only. Shape the driver interface so
     a `sqlite:` engine (per-plugin file namespace) is an addition, not a redesign — do
     not implement it.
   - `databaseLayer(tag, url, { pluginId, schema, migrations?, namespace? })` —
     acquireRelease driver → apply migrations (lazy loader, keeps the
     `virtual:drizzle-migrations.sql` carrier) → typed db on the plugin-owned tag.
     `namespace: false` for api (public) and auth (dedicated DB).
   - `pluginSchemaName(pluginId)` — export the existing canonical derivation.
   - Verify: `grep -rn "from \"pg\"\|from \"@electric-sql/pglite\"" packages/everything-dev/src/db/`
     → no static runtime imports.
3. **`_template` collapses** to the reference shape: `db/layer.ts` becomes ~10 lines
   (tag + `databaseLayer` call), `db/{index,migrator}.ts` deleted, private `normalizeSlug`
   deleted, `PluginIdTag` gone from the layer (id arrives via `config.pluginId` —
   effect-native Phase 1.2). rspack externals and the virtual-module migration pipeline
   stay. **Journal standardization**: adopt `_template`'s in-schema `drizzle_migrations`
   history into `drizzle.__drizzle_migrations` once (copy hashes, freeze the old table),
   idempotently and fail-closed.
4. **Workspaces adopt** (each independently shippable):
   - **api** — `databaseLayer(tag, url, { pluginId, namespace: false })`; delete its
     driver/runner copies.
   - **auth** — dedicated DB, `namespace: false`; delete its copies.
   - **proposals, votes** — delete the dead `pluginId === "api"` special case (their
     schemaName is already always `plugin_<slug>` — no data migration) and the runner
     copies; the 25P02 fix arrives via the shared runner.
   - **apps** — no db; unaffected beyond plan 007's lib work.
5. **Sync exits db ownership**: `FRAMEWORK_OWNED_SYNC_FILES` and the per-plugin derived
   list in `packages/everything-dev/src/cli/sync.ts` drop `src/db/**` and
   `src/lib/context.ts` entirely. Pristine children get the removal via existing
   upstream-deleted semantics; **locally-modified files must be kept** (verify with a
   fixture child carrying an edited `db/layer.ts`).
6. **Docs**: AGENTS.md scoped-resources guidance points at `databaseLayer` +
   `Layer.provide` (the effect-native shape); the plugin-development skills updated.

## Verification

- After step 2: `bun run build` in `packages/everything-dev`; `bun typecheck`; `bun lint`.
- After step 3: `bun run --cwd plugins/_template test` and `cd plugins/_template && bun run build`
  (externals intact — no pg/pglite in the bundle).
- **No-migration proof** (after each workspace in step 4): with
  `docker compose up -d --wait`, snapshot
  `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'plugin_%'`
  and each journal's rows before/after booting the stack — identical sets (the
  `_template` journal adoption in step 3 is the only sanctioned difference).
- Workspace suites: `bun run --cwd api test`, `bun run --cwd plugins/{proposals,votes} test`.
- Step 5: `bun run --cwd packages/everything-dev test` — add
  `sync.template.test.ts` cases for the db-file exit (pristine child → removed; edited
  child → kept).
- `bun run --cwd host test` (2 `runtime-remote` failures are known deploy-gated).

## STOP conditions

- Any pre/post schema or journal diff in the no-migration proof beyond the sanctioned
  `_template` adoption — the slug decision (D1) is wrong for that workspace; stop and
  re-derive before touching data.
- Sync would delete a locally-modified framework-owned db file — user-source loss; fix
  the deletion semantics before shipping.
- The `everything-dev` dist statically pulls `pg`/`pglite`/`drizzle-orm` runtime values
  — redesign to dynamic imports/type-only.
- Effect-native Phase 4 lands conflicting rewrites of the same plugin files — rebase
  this plan's steps 3–4 onto the landed shape rather than interleaving edits.
