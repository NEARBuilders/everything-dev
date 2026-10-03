# Plan 027: DB receipt — `everything-dev/db` runtime layer for plugins

> **Executor instructions**: Follow step by step; run every verification
> command; STOP conditions below. Update your status row in
> `advisor-plans/README.md` when done.
>
> **Drift check**: `git diff --stat 00d162cb..HEAD -- plugins/_template/src/db
> packages/everything-dev/src/db packages/every-plugin/src`.
> Prerequisite: advisor plan 008 (`008-migrate-consolidation.md`) is DONE
> (per `advisor-plans/README.md` status) — this plan builds on its migration
> runner consolidation. If 008 is still TODO, STOP and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 008-migrate-consolidation.md (existing advisor plan; runs
  parallel to the 021–026 UI track)
- **Category**: tech-debt / architecture
- **Planned at**: commit `00d162cb`, 2026-09-18

## Why this matters

Every database-backed plugin copies the same ~40-line `src/db/layer.ts`
(schema-name derivation, driver acquire/release, migration import + run).
The decided design (advisor plan 017 / ticket #89, amended 2026-09-15) homes
this in `everything-dev/db` as a runtime export — "api gets passed a ready,
schema-isolated, migrated db client" — with db files exiting sync ownership.
Today `packages/everything-dev/src/db/` exists but contains only CLI-side
binding/drizzle-kit machinery; the runtime layer is missing. This plan
implements it and adopts it in the template, making the pattern the one
inline file for schema + a 10-line layer.

## Current state

- `packages/everything-dev/src/db/` (verified): `binding.ts`
  (`bindingEnv({secretName, url})` — pushes resolved URLs into spawned
  processes), `bindings.ts`, `core.ts` (`normalizeSlug`, migration-storage
  helpers), `drizzle-kit.ts`, `identity.ts` — **all CLI-side**; `index.ts`
  re-exports all five. Export map `"./db"` exists
  (`package.json` lines 175-182).
- `plugins/_template/src/db/layer.ts` (verified, the copy-paste target):
  ```ts
  export const DatabaseTag = Context.Service<TemplateDatabase, TemplateDatabase>()("template/Database");
  function normalizeSlug(pluginId: string): string {
    return pluginId.replace(/^@[^/]+\//, "").replace(/-plugin$/, "")
      .replace(/[-\s]/g, "_").toLowerCase();
  }
  export const DatabaseLive = (url: string) =>
    Layer.effect(DatabaseTag, Effect.gen(function* () {
      const pluginId = yield* PluginIdTag;
      const schemaName = `plugin_${normalizeSlug(pluginId)}`;
      const driver = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const { createDatabaseDriver } = await import("./index");
          return createDatabaseDriver(url, schemaName);
        }),
        (driver) => Effect.promise(() => driver.close()),
      );
      const migrations = yield* Effect.promise(async () => {
        const mod = await import("virtual:drizzle-migrations.sql");
        return mod.default;
      });
      yield* Effect.promise(() => migrate(driver.db, migrations, schemaName));
      yield* Effect.logInfo("[Template] Migrations applied");
      return driver.db;
    }));
  ```
- `plugins/_template/src/db/index.ts`: `createDatabaseDriver(url, schemaName)`
  (drizzle + pg driver, schema-qualified).
- Decided design (advisor 017 / `plans/v1-current/every-plugin-db-auth-absorption.md`):
  `everything-dev/db` gains `createDatabaseDriver`/`databaseLayer`/
  `runMigrations` + `pluginSchemaName`; plugin db files exit sync ownership;
  no `every-plugin/db` facade (rejected in the amendment).
- Migration timing tiers (wayfinder ticket 11 / composable.md): workshop =
  boot-time migrate (current behavior), production = pre-migrated — tiered
  timing lands with plan 031, not here.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `bun typecheck` | 8/8 workspaces pass |
| Lint | `bun lint` | exit 0 |
| Framework tests | `bun run --cwd packages/everything-dev test` | all pass |
| Template tests | `bun run --cwd plugins/_template test` | all pass |
| API tests (pglite) | `bun run --cwd api test` | all pass |

## Scope

**In scope**:
- `packages/everything-dev/src/db/runtime.ts` (create)
- `packages/everything-dev/src/db/index.ts` (re-export runtime)
- `packages/everything-dev/tests/db/runtime.test.ts` (create)
- `plugins/_template/src/db/layer.ts` (rewrite as thin wrapper)
- `plugins/_template/src/db/index.ts` (keep driver; may move into runtime)
- `packages/everything-dev/package.json` (peer deps if drizzle/pg become
  required peers — follow existing peer pattern in the package)
- Changeset (`everything-dev` minor)

**Out of scope**:
- `api/src/db/**` (the API host's own database layer — separate concern)
- `packages/every-plugin/**` (no db facade there — rejected design)
- Migration *timing* tiers (plan 031)
- Any other plugin's adoption (follow-up, one-line change each)

## Git workflow

- Branch: `feat/db-receipt`. Conventional commit:
  `feat(everything-dev): runtime db layer — schema-isolated driver + migrations`.

## Steps

### Step 1: Runtime module

`packages/everything-dev/src/db/runtime.ts`:
- `pluginSchemaName(pluginId: string): string` — move `normalizeSlug` here
  (dedupe with `db/core.ts`'s `normalizeSlug`: core's version normalizes
  package names for migration slugs; keep both but implement one in terms of
  the other, or export core's and map — read both before choosing; the
  outputs MUST stay identical to today's `plugin_<slug>`).
- `pluginDatabaseTag<T>(pluginId: string)` → `Context.Service` tag named
  `<pluginId>/Database` (Effect 4 `Context.Service<TagName, Shape>()` idiom —
  match `_template`).
- `databaseLayer<T>(opts: { url, pluginId, schema, migrations }): Layer.Layer<T>` —
  the `_template` body verbatim, parameterized (acquireRelease driver,
  `runMigrations`, log).
- `runMigrations(db, migrations, schemaName)` — from
  `_template/src/db/migrator` (read it; move the runner, not a copy).

Import `createDatabaseDriver` from a real dependency location: today
`_template/src/db/index.ts` owns the driver; move the driver factory into
`runtime.ts` (drizzle + pg are available via peers — check
`packages/everything-dev/package.json` peers and mirror
`@proj-airi/unplugin-drizzle-orm-migrations`'s optional-peer pattern for
`drizzle-orm`/`pg`).

**Verify**: `bun run --cwd packages/everything-dev test` → new runtime tests
pass; `bun typecheck` → 0 errors.

### Step 2: Template adopts the runtime layer

`plugins/_template/src/db/layer.ts` shrinks to: schema-tag type re-export +
```ts
export const DatabaseLive = (url: string) =>
  databaseLayer<TemplateDatabase>({ url, pluginId: "template", schema,
    migrations: (await import("virtual:drizzle-migrations.sql")).default });
```
(adjust to sync/async import reality of the virtual module). Behavior,
schema name, logs identical. `plugins/_template/src/db/index.ts` keeps only
what the template's services import beyond the driver.

**Verify**: `bun run --cwd plugins/_template test` → all pass; plugin boots
in `bos dev` smoke with migrations applied log unchanged.

### Step 3: Fixtures + changeset

- Runtime tests: schema-name slug cases (scoped `@org/name-plugin` variants),
  migrate idempotence (run twice, single journal), layer teardown closes the
  driver (acquireRelease assertion).
- Changeset: `everything-dev` minor — runtime db layer export.

**Verify**: `bun run --cwd packages/everything-dev test` → all pass; `bun
lint` → exit 0.

## Test plan

- New: `packages/everything-dev/tests/db/runtime.test.ts` (slug table-driven;
  idempotent migrate against pglite; release-closes-driver).
- Pattern: existing `packages/everything-dev/tests/` vitest setup.
- Template suite must remain green without modification (behavior-preserving
  rewrite) except import paths.

## Done criteria

- [ ] `bun typecheck` 8/8; `bun lint` clean
- [ ] `grep -n "normalizeSlug" plugins/_template/src/db/layer.ts` → no matches
      (moved); runtime exports `pluginSchemaName`/`databaseLayer`/
      `runMigrations`/`pluginDatabaseTag`
- [ ] `bun run --cwd plugins/_template test` green
- [ ] `bun run --cwd packages/everything-dev test` green incl. new tests
- [ ] Changeset written; README row updated

## STOP conditions

- `virtual:drizzle-migrations.sql` cannot resolve from the framework package
  (the virtual module is wired per-workspace by the rspack plugin) — the
  migrations import may need to stay plugin-side; report the cleanest split
  you find rather than duplicating the runner.
- `db/core.ts` slug outputs diverge from `_template`'s for any input in the
  table-driven test — report the mismatch; do not "fix" either silently.

## Maintenance notes

- Plans 031 (tiered migration timing) and 028 (descriptor `bindings: { db }`)
  build on this surface — keep signatures additive.
- Plugin adoption across `plugins/*` is a one-line follow-up per plugin;
  batch it after template proves the wrapper.
- Reviewers: slug identity (schema names must never change for existing
  databases — this is data-path-critical) and driver cleanup on scope close.
