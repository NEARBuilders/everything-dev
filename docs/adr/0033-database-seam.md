# ADR 0033: The database seam — `databaseLayer`, and the db/context ownership exit

Date: 2026-10-20
Status: Accepted

Depends on: ADR 0019 (migration serialization advisory lock), ADR 0031 (package shape), ADR 0032 (framework-owned files inventory).

Implements the remaining work of [docs/plans/v1-current/every-plugin-db-auth-absorption.md](../plans/v1-current/every-plugin-db-auth-absorption.md) (D1 pluginId-as-value, D3 `databaseLayer` factory, D4 sync-ownership exit).

## Context

A DB-backed workspace carries `src/db/{index,layer,migrate}.ts` (~180 lines), `schema.ts`, `migrations/`, and a `drizzle.config.ts` — the trio sync-owned and overwritten by `bos sync`. The framework-owned DB plumbing is too aggressive: the storage setup is *one suggested option* (Drizzle + Postgres/PGlite with schema isolation), not a mandate, and owning its files means apps cannot reshape their own persistence without fighting sync. Meanwhile the per-workspace trio is already a thin adapter over `everything-dev/db` — the engine selection, pool/TLS/`search_path` wiring, migration runner (journal-scoped advisory lock), drift detection, and workspace identity all live in the package. What remains per-workspace is exactly the app's own inputs: its schema, its migrations, its plugin id, its namespace choice.

The service shape everywhere is the raw drizzle `PgDatabase` — every service layer does `db.select()...`. And `PluginIdTag` leaks into every plugin author's layer (`DatabaseLive` reads it to derive the schema slug), with a dead `pluginId === "api"` special case copied across workspaces.

## Decision

1. **`everything-dev/db` exports `databaseLayer` — the plugin author's whole database surface:**

   ```ts
   databaseLayer<Identifier, TSchema>(
     tag: Context.Service<Identifier, PgDatabase<PgQueryResultHKT, TSchema>>,
     url: string,
     options: {
       pluginId: string;
       schema: TSchema;
       migrations?: Effect.Effect<LoadedMigrations, DatabaseError>;
       namespace?: boolean;   // default true → plugin_<slug>; false → public/dedicated
     },
   ): Layer.Layer<Identifier, DatabaseError>;
   ```

   One call: `Effect.acquireRelease` the driver (finalizer = pool teardown), apply migrations on boot (journal-scoped advisory lock, ADR 0019), detect drift (healthy / repairable / manual semantics unchanged), return the typed db on the tag. Error channel `DatabaseError` throughout (`return yield*`, never bare `throw`). Deviation from the D3 sketch: `migrations` takes the landed `Effect<LoadedMigrations, DatabaseError>` loader (008's consolidation), not `() => Promise<Migration[]>` — the Effect composes into the layer's error channel without an adapter.

2. **The tag is plugin-owned — the swap seam.** `databaseLayer` fills an interface the app declares; the test adapter proves the seam is real (`Layer.succeed(DatabaseTag, fakeDb)` satisfies the same interface). Three adoption tiers:
   - **Suggested default** — call `databaseLayer` with your schema/migrations (what `_template` scaffolds).
   - **Different drizzle setup** — write your own `Layer.effect(YourTag, ...)` from the package's primitives (`createDatabaseDriver`, `loadMigrations`, `runMigrations`, `detectDrift`), or wrap `databaseLayer` with different options.
   - **Totally different storage** — your own tag, your own layer; nothing framework-forced reaches your plugin.
   When `@effect/sql` v4 or alchemy's `Drizzle.Postgres` runtime client lands (the plan's "future seams"), `databaseLayer` internals change; no plugin or service code does.

3. **`pluginId` arrives as a value on the initialize input.** `PluginInitializeInput` gains `pluginId: string` — the same id the host uses for secret injection and namespacing, so schema, secret name, and journal derive from one source. No `PluginIdTag` in new plugin code (the tag and its loader provision stay exported for children's vendored layers until they port). The dead `slug === "api"` special case dies: the api shell passes `namespace: false` explicitly at its one call site, plugins take the namespaced default.

4. **Tag ids are plugin-namespaced** (`"api/Database"`, `"auth/Database"`, `"votes/Database"`, `"proposals/Database"`, `"template/Database"`). The host merges per-plugin `effectContext`s into one request context (`host/src/routes/api.ts`, `host/src/services/mcp.ts`); five bundles carrying the same bare `"Database"` id is a latent collision. Invariant, recorded: **the db tag is plugin-local — cross-plugin data access goes through `pluginsClient` routes, never through the merged context.**

5. **Ownership exit (D4, as amended):** `db/**` (the trio) **and `lib/context.ts`** leave `FRAMEWORK_OWNED_SYNC_FILES` and the sync fan-out; **`drizzle.config.ts` stays owned**. The split follows what each file *is*:
   - `drizzle.config.ts` — identity-driven wiring with zero app decisions, carrying journal *policy* (schema/table from workspace identity); owned so journal-convention changes propagate via sync.
   - `src/db/*` — the storage seam itself; scaffolded once as the suggested default, then app-owned and free to swap (the ADR 0023 `router.tsx` pattern).
   - `lib/context.ts` — the plugin's request-context schema, typed to its own generated `auth-types.gen`; app surface that framework ownership made uneditable by design.
   No deletion, no codemod: existing children's trios keep working (the package exports they use are untouched); sync simply stops consulting the paths. The one-time `_template` journal adoption from D6 is already landed (all workspaces standardize on `drizzle.__drizzle_migrations`).

6. **The port is a prompt, not a codemod.** Existing children migrate via an agent-facing, copy-pastable prompt in `everything-dev#init-upgrade` (replace the trio with the ~15-line `layer.ts`, keep `schema.ts`/`migrations/`/`drizzle.config.ts`, re-point `DatabaseError` imports to `everything-dev/db`, drop `PluginIdTag` test setup, run the plugin's tests). Referenced from the changeset so upgrade-time agents find it.

## Consequences

- A fresh DB-backed plugin: `schema.ts` + `migrations/` + a ~15-line `db/layer.ts` — everything else comes from the package. `_template` and `.github/templates/api` ship the shrunk default.
- The migrate-on-boot ordering bug class (the 25P02 savepoint issue the per-workspace copies carried) can no longer be re-authored per workspace — the ordering lives once in the factory.
- The characterization suite over the deleted workspace copies runs against the shared runner directly; new `databaseLayer` tests pin namespace topologies, migration-on-build idempotence, the error channel, and finalizer teardown (pglite-backed).
- The service shape stays the raw drizzle `PgDatabase` — deliberate: zero churn in every service layer; the deeper query-interface redesign is beta-v2 territory when `@effect/sql` v4 exists.
