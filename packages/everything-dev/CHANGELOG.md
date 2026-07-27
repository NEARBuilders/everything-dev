# everything-dev

## 1.51.6

### Patch Changes

- b34b4c6: Fix FastKV config URL construction: append storage key as URL path segment instead of POST body
- 7784fac: Fix Zephyr auth/output logs being silently suppressed during `bos publish --deploy`. Always forward stderr from build processes, broaden Zephyr log detection to catch all `ZEPHYR`-branded lines and `ZE` error codes, and include Zephyr context in upload failure messages.

## 1.51.5

### Patch Changes

- 6bc36f0: Overhaul CI/CD workflow architecture: switch from `workflow_run` triggers to `repository_dispatch` chain to eliminate skipped runs, sequence Deploy after Release+Docker to prevent stale Railway redeploys, gate Docker on actual npm publishes, move framework tests from Release to CI with path-based filtering, add Playwright browser caching, fix unsafe `git rebase -X theirs` in deploy/staging retries, and remove duplicate GitHub release creation from Deploy.

## 1.51.4

### Patch Changes

- 9cabc3a: Strip hash fragment from BOS URL in `parseBosUrl` to fix IntegrityMonitor lookup failure when an `extends` reference includes a JSON pointer target (e.g. `bos://auth.everything.near/auth.everything.dev#app.auth`). The fragment has no meaning in FastKV key resolution and was causing "No config found" errors during integrity checks.

## 1.51.3

### Patch Changes

- d03dd58: Inline `<script>` JSON is now escaped (`</script>`, U+2028, U+2029) to prevent XSS and script-breakage; the CSP nonce is serialized null-safe. Hydration failures now clear `__EVERYTHING_DEV_HYDRATE_PROMISE__` so a retry can succeed instead of permanently returning a rejected promise. An explicit `__EVERYTHING_DEV_SSR__` flag is injected during server render for reliable SSR detection. The `.env.example` template is expanded with all secret placeholders grouped by app section.

## 1.51.2

### Patch Changes

- 9a0220e: Harden the `bos upgrade` scoped-layer codemod to also scan `api/src/index.ts` (previously only `plugins/*/src/index.ts`) and to rewrite the `.pipe(Effect.provide(<Layer>))` form into `tools.buildService(<Tag>, <Layer>)`. This pattern bound `acquireRelease` finalizers to a temporary scope that closed at the end of `initialize`, causing resources like database pools to be released (e.g. `pool.end()`) immediately at startup instead of during graceful shutdown. Children using this form are auto-migrated on upgrade; ambiguous cases emit a warning and are left for manual migration.

## 1.51.1

### Patch Changes

- fee6577: Fixed production host binding to port 443 (derived from the HTTPS CDN URL) instead of the planned listening port (3000, or `--port` flag value). The planner already resolved the correct port, but the `start` command discarded `plan.runtimeConfig` and stored the original — whose `host.port` came from `parsePort(remoteUrl)`. Now `start` uses `plan.runtimeConfig` so each app binds to its allocated port. Also stops deriving the listening port from the remote URL in `buildRuntimeConfig` for production; uses `DEFAULT_HOST_PORT` and lets the planner override.

## 1.51.0

### Minor Changes

- acf134e: Removed the pglite URL validation guard on `API_DATABASE_URL` in production. Added `tsconfig.json` and `tsconfig.contract.json` to the plugin sync template, so plugin tsconfigs are now framework-owned and synced during `bos sync`.

## 1.50.0

### Minor Changes

- 58272ad: ## Infra planner, preflight, and unified allocation

  - `infra/types.ts` (new): `CliPorts`, `ResolvedPorts`, `RuntimeLaunchSpec`, `InfraPlan`, `InfraError`, `ServiceDescriptorPlan`, `ComposeModelPlan`, `DatabasePlan`, `RedisPlan`, `ClaimRecord`, `InfraInput` — typed contract for the entire dev/start infra planning pipeline.
  - `infra/planner.ts` (new): `planInfra(input)` — one scoped Effect that computes service ports, DB/Redis ports, service descriptors, env values, compose model, and launch spec from a single `InfraInput`. Deterministic `workspaceKey` hashing for stable per-workspace port blocks. Replaces disparate allocation in `app.ts`, `cli/infra.ts`, and `plugin.ts` with one authoritative pipeline.
  - `infra/preflight.ts` (new): `preflightLocalInfra(env, overrides?)` — TCP and real Postgres (`SELECT 1`) reachability checks for local `*_DATABASE_URL` and `*_REDIS_URL` entries. Fails fast with descriptive errors before any process starts. Uses merged effective env (plan + process.env).
  - `app.ts`: `prepareDevelopmentRuntimeConfig` now returns `Effect<PreparedDevRuntime, PortAllocationError, PortAllocator>` and `PortAllocatorLive` seeds `usedPorts` from `claimedPorts()`. Bind-based TCP probing and parallel candidate scanning added.
  - `plugin.ts`: dev handler routes through `planInfra(...)` via `Effect.runPromise(...pipe(Effect.provide(PortAllocatorLive)))`. Uses `buildServiceDescriptorMapFromPlan` for descriptor authority. Materializes generated infra from plan via `materializeInfraPlan(...)`. No more duplicated `syncGeneratedInfra` from runtime config.
  - `process-registry.ts`: `PidEntry.ports` widened from fixed `{host,api,ui,auth}` to `Record<string, number>`. `claimedPorts()` iterates `Object.values()`. Removes cast-based port smuggling.
  - `dev-session.ts`: registry registration includes `uiSsr`, plugin, and plugin-ui ports.
  - `cli/infra.ts`: pure helpers `buildDatabaseConfigs`, `buildRedisConfigs`, `buildOriginMap`, `getSecretGroups`, `renderEnvFile`, `renderDockerCompose` now exported. Added `renderEnvFileFromPlan`, `renderDockerComposeFromPlan`, and `materializeInfraPlan(...)` for plan-driven file generation.
  - `service-descriptor.ts`: added `buildServiceDescriptorMapFromPlan(plan, options?)` as the single authority path.
  - `orchestrator.ts`: `ServerInput` extended with `port` and `env`. `spawnRemoteHost` passes explicit planned port and env into `runServer(...)`, fixing the `:443`/`:5100` drift.
  - `host/src/program.ts`: `runServer(...)` applies `input.port` and `input.env` entries to `process.env` before starting the server.

  ## Remote host bind semantics (Patch A)

  - `infra/planner.ts`: host now always receives local bind `port`/`url` from `resolvedPorts.host`, even when `host.source === "remote"`. `remoteUrl` is preserved for remote host. All other services only get localhost rewrite when source is local — remote api/auth/ui/plugin URLs stay untouched.
  - This fixes the bug where remote host was binding `5000`/`5100` instead of the user's `--port` value.

  ## UI/SSR port honoring (Patch B)

  - `ui/package.json`: `dev:ssr` script no longer hardcodes `PORT=3004`.
  - `ui/rsbuild.config.ts`: server port reads `process.env.PORT` first, falling back to `3003`/`3004`. This means the planner-chosen UI/SSR ports are now honored by rsbuild.

  ## DB preflight strengthening (Patch C)

  - `infra/preflight.ts`: preflight now uses merged effective env (`plan.envGenerated` overlaid with `process.env`). Real Postgres connection (`SELECT 1`) for local `*_DATABASE_URL` targets, not just TCP. TCP-only for `*_REDIS_URL`. Differentiates "not listening" from "reachable but pg rejects".

  ## Descriptor authority cleanup (Patch D)

  - `service-descriptor.ts`: `buildServiceDescriptorMapFromPlan(plan, options?)` added. `plugin.ts` now uses it instead of raw `buildServiceDescriptorMap(plan.runtimeConfig, ...)`. One descriptor authority path.

  ## Link: handling for version display, status, and upgrade

  - `cli/framework-version.ts`: added `resolveFrameworkPackage(...)` returning `specifier`, `installedVersion`, `isLinked`, `isWorkspaceLike`. Handles `link:` specifiers by reading actual installed version from `node_modules`.
  - `cli.ts`: banner resolves effective linked version and displays `v1.49.0 (linked)`.
  - `cli/status.ts`: status returns `isLinked` and `specifier` per package.
  - `contract.ts`: Zod schema for status extended with `isLinked` and `specifier`.
  - `cli.ts:warnIfOutdated`: skips linked packages, shows "is linked locally" note instead of bogus upgrade nag.
  - `cli/upgrade.ts`: `readCurrentPackageSpecifier` handles `link:`, `packageObjectNeedsCatalogRefs` exempts `link:`, `setCatalogRef` preserves `link:`.
  - `internal/manifest-normalizer.ts`: preserves `link:` in catalog package normalization during child manifest building.

  ## Root package manifest

  - `package.json`: added `"pg": "catalog:"` to root `dependencies` and `"@types/pg": "catalog:"` to root `devDependencies` for explicit hoisting of Postgres client dep.

  ***

  No breaking changes to published `exports` map. All new types and functions are internal to the package. `link:` handling is additive — existing `workspace:`/`file:`/`catalog:` behavior is preserved.

- f7745f4: Increase default publish key allowance from `0.25NEAR` to `1NEAR` to cover the NEP-642 10x gas purchase price increase. Enforce a minimum of `0.3NEAR` on `--allowance`.

  Rename `bos key publish` → `bos key generate` — "publish" was misleading since nothing is published.

  `bos key generate` now lists existing publish keys, generates the new key first, then prompts to remove the old ones (no more manual `near account delete-keys` step).

  Better error message when the publish key has insufficient allowance — tells the user to run `bos key generate`.

- 58272ad: Route all migration storage access through `getMigrationStorage` and retire `SHARED_MIGRATION_STORAGE`.

  Each DB-enabled workspace (api, each plugin) has its own database via `*_DATABASE_URL`. This change standardizes the migration journal name within each database — it is not cross-plugin sharing. Phase 1 uses the drizzle-kit default journal name (`drizzle.__drizzle_migrations`) within each workspace's DB; phase 2 will slug-namespace the journal name (`__drizzle_migrations_<slug>`) within each DB.

  - `packages/everything-dev/src/db.ts` — `getMigrationStorage(slug?, options?)` is now the single entry point for migration journal coordinates. A `PER_PLUGIN_ISOLATION` boolean gates default-vs-per-plugin journal table naming; phase 1 keeps the default `drizzle.__drizzle_migrations` table, phase 2 flips to `__drizzle_migrations_<slug>` with no caller changes. An `{ isolated?: boolean }` option overrides the default for testing and legacy-migration imports. `SHARED_MIGRATION_STORAGE` is removed; default coords inlined behind the gate as `DEFAULT_MIGRATION_JOURNAL`. The `slug` argument is normalized inside the function (idempotent for already-normalized slugs), so callers can pass raw plugin keys like `@everything-dev/foo-plugin` directly. The returned `slug` is always the caller's plugin slug (not `__drizzle_migrations`), so error messages and reports identify the actual plugin. `getLegacyCandidates()` and `migrateSql()` are removed as dead code — the preflight table-existence check in `migrate()` is the better way to handle legacy journal locations (`public.drizzle_migrations`) and missing journals: it auto-records migrations as applied when their target tables already exist, idempotently, at runtime.
  - `api/src/db/layer.ts` — resolves storage via `getMigrationStorage(getMigrationSlug(import.meta.dirname))`. Drift errors now reference the real plugin slug (e.g. `bos db doctor api`) instead of `__drizzle_migrations`, and the drift-safe-repair message no longer says "isolated" (phase 1 uses the default journal).
  - `api/drizzle.config.ts` — derives `slug` via `getMigrationSlug(import.meta.dirname)` instead of the hardcoded `"api"`, then uses `getMigrationStorage(slug)` for the `migrations` block. The derived value still matches `"api"` in this repo, but synced child plugins now pick up their own package name automatically. **Behavior change for synced child projects**: the `slug` is no longer literal — child projects with a non-`api` package name will see their derived slug in the database secret name and pglite fallback path.
  - `api/src/db/migrate.ts` — `migrate()` and `detectDrift()` accept a `storage` parameter (renamed from `_storage`) and default to `getMigrationStorage()` when none is passed. JSDoc on both directs plugin authors to pass an explicit `getMigrationStorage(getMigrationSlug(import.meta.dirname))` for reliable slug derivation under rspack/Module Federation bundling. `ensureMigrationTable()` now parameterizes the schema name via `storage.schema` instead of hardcoding `"drizzle"`.
  - `packages/everything-dev/src/cli/db-doctor.ts` — derives journal coordinates from `getMigrationStorage(pluginMigrationSlug(info.key))`; the report's `slug` field now shows the actual plugin.
  - `packages/everything-dev/src/cli/db-repair.ts` — reuses the diagnosis's `journalSchema`/`journalTable` (single source of truth) instead of re-importing the shared constant. `recreate` mode refusal message clarified to mention "per-plugin database schemas" (a future phase concern distinct from per-plugin journals).
  - `packages/everything-dev/src/cli/db-studio.ts` — `runStudioRemote` now generates its Drizzle Studio config with `getMigrationStorage(pluginMigrationSlug(info.key))` instead of hardcoding the per-plugin `__drizzle_migrations_<slug>` form. Previously Studio introspected a journal table that didn't exist in phase 1. Mid-file `import { pluginMigrationSlug }` hoisted to the top import block.
  - `packages/everything-dev/src/cli/sync.ts` — removes stale `migration-storage` alternative from the framework-owned sync regex; the file was removed in a prior change.
  - `packages/everything-dev/skills/plugin-development/SKILL.md` — the `migrate()` snippet now shows passing an explicit `storage` resolved from `import.meta.dirname`, with a note that the no-arg fallback relies on `npm_package_name` and is unreliable under bundlers.
  - `packages/everything-dev/tests/unit/db.test.ts` — covers the phase-1 default form, default slug resolution, raw-key normalization, and a new `getMigrationStorage (isolated)` suite that exercises `{ isolated: true }` and `{ isolated: false }` to lock in the phase-2 flip. Removes the `getLegacyCandidates` test (function removed).
  - `package.json`, `api/package.json`, `packages/everything-dev/package.json` — add `engines.node: ">=20.11"` to enforce the `import.meta.dirname` floor (already used in 19 sites across the repo).

  Legacy migration upgrade path: child repos that previously ran `drizzle-kit migrate` against `public.drizzle_migrations` (or have no journal at all) are handled automatically at runtime. `migrate()` creates `drizzle.__drizzle_migrations` if missing, then for each migration checks whether its target tables already exist in the `public` schema — if they do, it records the migration as applied in the new journal without replaying DDL. This is idempotent and handles both legacy journal locations and missing journals without hash import.

  Phase 2 (per-plugin journal isolation) becomes a one-line flip of `PER_PLUGIN_ISOLATION` in `packages/everything-dev/src/db.ts` plus a package republish — no caller changes required. The `{ isolated: true }` option is already exercised by tests, so the flip is verified-by-proxy.

- 58272ad: Introduce `PortAllocator` Effect service, bind-based port probing, parallel candidate scanning, and async registry pruning.

  ## PortAllocator service + tagged errors (A+B)

  - `app.ts`: `PortAllocator` `Context.Tag` with `pickAvailable(preferred, budget?)` returning `Effect<number, PortAllocationError>`. `PortAllocationError` is a `Data.TaggedError` with `preferred`, `budget?`, and `cause?` fields, replacing the bare `RangeError` throws from the prior implementation.
  - `prepareDevelopmentRuntimeConfig` is now an `Effect.gen` that yields `PortAllocator` for each port pick. Returns `PreparedDevRuntime` = `{ runtimeConfig, devPorts }` — the caller no longer re-derives `devPorts` from the runtime config (eliminates duplicated `hasLocalPlugin`/`firstLocalPluginPort` logic in `plugin.ts`).
  - `PortAllocatorLive` layer co-located in `app.ts`, seeds `usedPorts` from `claimedPorts()` (flattened from the global PID registry) so concurrent `bos dev` sessions skip ports already claimed by live sessions. Fixes the multi-instance port collision observed with `overmind`.
  - `plugin.ts` dev handler wraps the call in `Effect.runPromise(...pipe(Effect.provide(PortAllocatorLive)))` and uses the returned `devPorts` directly in `savePortState`.
  - `process-registry.ts`: replaces `claimPorts()` (array of port-maps) with `claimedPorts(): Set<number>` (flattened set for direct `usedPorts` seeding).
  - Tests: `app.test.ts` rewritten with a hermetic `PortAllocatorTest` layer — no real TCP probing. Covers Bug C (remote host preserved), Bug A (remote services → undefined devPorts), budget clamping/success, `claimPorts` seeding, and `PortAllocationError` on budget exhaustion (verified via `Effect.runPromiseExit` + `Cause.pretty`).

  ## Bind-based port probing (smell #2)

  - Replaced connect-based `probeTcpOpen` (which only detected "is something already listening") with bind-based `probePortBindable` using `net.createServer().listen(port, "127.0.0.1")`. This catches `EADDRINUSE` for bound-but-not-listening sockets and `EACCES` for privileged ports — cases connect-based probing missed. The server is closed in the `listening` callback before the Effect resolves, narrowing the TOCTOU window between probe and child bind.

  ## Parallel candidate probing (smell #4)

  - `pickAvailablePort` now probes `PARALLEL_PROBE_WINDOW` (8) candidate ports in parallel via `Effect.forEach` with `concurrency: "unbounded"`, taking the first free one. Eliminates the sequential 250ms-per-busy-port walk that could add 1+ seconds to startup on busy hosts.

  ## Async pruneDead (smell #8)

  - `process-registry.ts`: added `pruneDeadEffect(entries): Effect<PidEntry[]>` that uses `fs.promises.access` (async) instead of `existsSync` (sync) for `configDir` checks, with `Effect.forEach` concurrency unbounded. Sync `pruneDead` retained for low-frequency callers (`registerStandalone`, `unregisterPid`, `claimedPorts`).
  - `plugin.ts`: `ps` and `kill` handlers now use `pruneDeadEffect` via `Effect.runPromise`, avoiding blocking the main thread on sync filesystem syscalls when the registry grows.
  - Test: `process-registry.test.ts` verifies `pruneDeadEffect` filters pid<=1, dead pids, and missing configDirs concurrently.

  ## Constants hoisted (smell #5)

  - `PROBE_TIMEOUT_MS`, `MAX_PORT_SCAN_STEPS`, `PARALLEL_PROBE_WINDOW` are named module-level constants instead of inline magic numbers.

  No breaking changes to the published `exports` map. `prepareDevelopmentRuntimeConfig` is internal (not exported via `package.json` `exports`), so the signature change from `Promise<RuntimeConfig>` to `Effect<PreparedDevRuntime, PortAllocationError, PortAllocator>` is safe.

- 58272ad: Add per-service dev port flags, persist dev port choices, derive CORS_ORIGIN from the actual host port, and add `bos ps`/`bos kill` process management.

  - `packages/everything-dev/src/contract.ts`: extend `DevOptionsSchema` with `apiPort`, `uiPort`, `authPort`, and `pluginPortStart` flags. Add `ps` (GET /ps) and `kill` (POST /kill, options `configDir`/`signal`/`all`) routes with `PsResultSchema`/`KillOptionsSchema`/`KillResultSchema`.
  - `packages/everything-dev/src/app.ts`: `prepareDevelopmentRuntimeConfig` now accepts `apiPort`/`uiPort`/`authPort`/`pluginPortStart`/`portBudget` options, threading each as the preferred value into `pickAvailablePort`. `portBudget` (`{min,max}`) rejects out-of-budget candidates with a `RangeError`, hardening the surface for a future `bos dev --workspaces` orchestrator.
  - `packages/everything-dev/src/plugin.ts`: the dev handler reads persisted dev ports from `.bos/infra-state.json`, prefers explicit input flags, falls back to persisted values, and finally to the bos-config host dev URL. After resolving ports it persists `runtimeConfig.{host,api,ui,auth}.port` plus the first local plugin port under a new `devPorts` key, so subsequent dev sessions pick the same ports without re-probing.
  - `packages/everything-dev/src/cli/infra.ts`: extend `PortState` with `devPorts?: { host?, api?, ui?, auth?, pluginPortStart? }`. `loadPortState`/`savePortState` are now exported for use by `plugin.ts`. `.env.example`'s `CORS_ORIGIN` now derives from `runtimeConfig.host.port` (falling back to `extractPortFromUrl(runtimeConfig.host.url)` then 3000) when `runtimeConfig.env === "development"`. Production/staging no longer override `CORS_ORIGIN` here — domain defaulting still happens in the start handler.
  - `packages/everything-dev/src/process-registry.ts` (new): global PID registry at `~/.cache/everything-dev/pids.json`, keyed by `pid`. Entry shape: `{ pid, configDir, parentPid?, role, ports, budget?, startedAt, description }`. Exports `readRegistry`/`writeRegistry`/`pruneDead`/`isPidAlive`/`registerStandalone`/`registerEntry`/`unregisterPid`/`removeRegistryFile`/`claimPorts`. Atomic write (tmp + rename); reads prune ESRCH PIDs. The entry shape is forward-compatible with a future `bos dev --workspaces` orchestrator (`parentPid`/`role`/`budget` are unused but reserved; only `role:"standalone"` is written today).
  - `packages/everything-dev/src/dev-session.ts`: `runDevSession` registers a standalone PID entry on startup unless `BOS_WORKSPACE_CHILD=1` is set, and unregisters in the scope finalizer. `DevRuntimeConfig` is now read at session start so host/api/ui/auth ports land in the registry.
  - `packages/everything-dev/src/cli.ts`: add print branches for `bos ps` (table with pid, role, age, dir, ports, budget, description) and `bos kill` (killed/skipped counts, plus guidance when no targets match).
  - `packages/everything-dev/src/contract.meta.ts`: register `ps` and `kill` command paths and field metadata so `--help` and `parseCommandInput` pick them up automatically.
  - Tests: `tests/unit/infra.test.ts` covers CORS_ORIGIN derivation from `host.port`, URL fallback, production no-override, and dev-ports persistence/legacy-file tolerance. `tests/unit/parse.test.ts` covers `--api-port`/`--ui-port`/`--auth-port`/`--plugin-port-start`/`--port` parsing on `dev`, plus `--config-dir`/`--signal`/`--all` on `kill`. `tests/unit/process-registry.test.ts` covers atomic write, de-dup, pruneDead, unregisterPid, corruption tolerance.

  Breaking changes: none. All new options are optional with sensible defaults; existing callers of `prepareDevelopmentRuntimeConfig` continue to work unchanged.

- 58272ad: Fix metadata files being blocked by narrowed static asset regex; standardize public file structure; renderClientShell delegates head data to UI's getRouteHead.

  - `host/src/program.ts`: Added `md` and `webmanifest` to `staticAssetPattern` (fixes regression from DDoS narrowing that blocked `.md` and `.webmanifest` from being proxied as static assets). DRY'd inline regex copy to use the named constant.
  - `host/src/program.ts`: Refactored `renderClientShell` to accept `HeadData` from the MF-loaded UI router module via `getRouteHead`. Host no longer hardcodes metadata (favicon, manifest, OG tags) — the UI's `__root.tsx` `head()` is the single source of truth. Minimal fallback shell (charset, viewport, title, boot scripts) when module is unavailable.
  - `packages/everything-dev/src/ui/router.ts`: Added `serializeHeadData` helper to convert structured `HeadData` (meta/links/scripts) to HTML strings for the raw shell.
  - `ui/public/`: Standardized on 15-file public structure. Renamed icon.svg→near.svg, icon_rev.svg→near_rev.svg, android-chrome-192x192.png→web-app-manifest-192x192.png, android-chrome-512x512.png→web-app-manifest-512x512.png. Generated favicon-96x96.png, logo.png. Removed legacy files (favicon-16x16.png, favicon-32x32.png, logo192.png, logo512.png, logo_rev.svg, logo.svg, manifest.json). Replaced manifest.json with site.webmanifest as single PWA manifest.
  - `ui/src/routes/__root.tsx`: Updated icon and manifest references to match new filenames.
  - `ui/public/site.webmanifest`: Merged richer icon set and fields from old manifest.json.

### Patch Changes

- 58272ad: Fix three bugs in the dev port and process-registry feature surfaced by real-world testing with `overmind` running two `bos dev` sessions in a multi-workspace project.

  - **Bug A — remote services wrote port 443/80 into `.bos/infra-state.json`.** `savePortState` in `plugin.ts` now gates each port slot on `runtimeConfig.<service>.source === "local"`, writing `undefined` for remote services. The `pluginPortStart` slot is gated on whether any local plugin exists. Test: `infra.test.ts` round-trips `undefined` devPorts slots for remote `api`/`auth`/`pluginPortStart`.
  - **Bug B — stale PID registry entries from prior test/dev runs survived `bos ps`.** `pruneDead` in `process-registry.ts` now filters entries with `pid <= 1` (init/kernel guards) and entries whose `configDir` no longer exists (`existsSync` check). A `BO_PID_REGISTRY_PATH` env var override is honored by `getRegistryPath`, letting tests isolate the registry without mutating `HOME`. Tests: `process-registry.test.ts` covers the pid≤1 guard, missing-configDir guard, env-var override, and stale fixture cleanup. The test harness now uses `BO_PID_REGISTRY_PATH` instead of `process.env.HOME` mutation, and existing fixture tests use real temp configDirs so they survive the new `existsSync` guard.
  - **Bug C — `prepareDevelopmentRuntimeConfig` clobbered remote `host.url`/`host.port` with `http://localhost:<picked>`.** The function now checks `runtimeConfig.host.source === "local"` before rewriting the host's url/port/entry. The picked host port is still reserved in `usedPorts` for budget accounting. Tests: `app.test.ts` (new) verifies remote host url/port are preserved, remote api service is left unassigned, and that local services still receive picked localhost ports. Also covers `portBudget` clamping and within-budget success.

  No breaking changes. All 172 unit tests pass; `bun run --cwd packages/everything-dev typecheck` is clean. Pre-existing lint findings in `ui/router.ts` and `host/src/program.ts` are unrelated (confirmed via `git stash`).

- 58272ad: Fix db.ts type error and conditionally copy plugin-owned UI routes during bos init.

  - `packages/everything-dev/src/db.ts`: fix TS2345 on `tables.add(tableName)` where `tableName` was `string | undefined` from `String.matchAll()`. Collapsed redundant `if (schemaName)/else if (tableName)` branches into a single `if (tableName)` guard.
  - `packages/everything-dev/src/cli/init.ts`: add `buildPluginRouteExclusions(parentConfig, selectedPlugins)` which returns UI route globs claimed by non-selected plugins. `copyFilteredFiles` and `writeInitSnapshot` now accept an optional `ignore` parameter merged into the glob ignore list.
  - `packages/everything-dev/src/plugin.ts`: the init command now computes route exclusions from the parent config and excludes plugin-owned routes (e.g. `ui/src/routes/_layout/apps/**`) when the corresponding plugin is not selected. This prevents scaffolded routes from referencing unconfigured plugin API namespaces (e.g. `apiClient.apps` without the `apps` plugin).
  - `bos.config.json`: remove `ui/src/routes/_layout/index.tsx` from `plugins.apps.routes` — the home route is a core route, not apps-specific.

- 58272ad: Security and correctness fixes from codebase audit:

  - **Require `API_DATABASE_URL` in production** — Removed the `:memory:` PGlite default from the API plugin schema. Uses a Zod `refine()` that rejects `pglite:` URLs when `NODE_ENV=production`, preventing silent data loss on restart. Updated `drizzle.config.ts` fallback to throw in production.
  - **Add warnings to empty catch blocks** — Added `console.warn` to 5 empty `catch {}` blocks across `config.ts` (\_resolved.json parse, package.json name resolution), `orchestrator.ts` (manifest fetch failure), and `cli/upgrade.ts` (plugin config parse and file deletion), turning silent fallbacks into actionable diagnostics.
  - **Add CSRF protection middleware** — Added `createCsrfMiddleware` to the host server that validates `Origin`/`Referer` headers against the allowed origins list for state-changing methods (POST/PUT/DELETE/PATCH), preventing cross-origin request forgery on cookie-authenticated endpoints.

## 1.49.0

### Minor Changes

- a825b17: Fix plugin DB config generation and migration slug resolution.

  - `packages/everything-dev/src/db.ts` now resolves workspace slugs from the local package directory and returns the correct table name for schema-qualified `CREATE TABLE` statements.
  - `api/drizzle.config.ts` and synced plugin copies now derive the database secret and fallback pglite URL from the local workspace slug.
  - `api/src/db/layer.ts` and `api/src/db/migrate.ts` now use workspace-local migration journals instead of falling back to the root package name.
  - `packages/everything-dev/tests/unit/db.test.ts` covers directory-based slug resolution and the corrected table extraction behavior.

## 1.48.0

### Minor Changes

- d3d5be1: Extract DB convention helpers into shared `everything-dev/db` package export.

  - `packages/everything-dev/src/db.ts` — new subpath export containing pure DB convention helpers:

    - `MigrationStorage` type, `getMigrationSlug()`, `getMigrationStorage()`
    - `getLegacyCandidates()`, `migrateSql()`, `extractExpectedTables()`
    - `pluginMigrationSlug()` for CLI plugin key normalization
    - `getDatabaseUrlSecretName()` for deterministic `*_DATABASE_URL` naming per workspace slug

  - `packages/everything-dev/package.json` — adds `./db` subpath export.

  - `api/src/db/migration-storage.ts` — removed; `api/drizzle.config.ts`, `api/src/db/migrate.ts`, `api/src/db/layer.ts` now import directly from `everything-dev/db`.

  - `api/tests/unit/migration-storage.test.ts` — removed (redundant with package-level tests).

  - `packages/everything-dev/tsdown.config.ts` — added `src/db.ts` entry point.

  - `packages/everything-dev/src/cli/db-studio.ts` — replaces inline `migrationSlug` with `pluginMigrationSlug` from the shared helper.

  - `packages/everything-dev/src/cli/db-doctor.ts` — replaces inline `extractTables` with `extractExpectedTables` from the shared helper.

  - `packages/everything-dev/src/cli/sync.ts` — adds `api/drizzle.config.ts` to framework-owned sync files; syncs it into DB-enabled plugin workspaces; adds plugin `drizzle.config.ts` to owned-file detection.

  - `packages/everything-dev/tests/unit/db.test.ts` — 8 tests covering slug derivation, table naming, table extraction, secret naming, and plugin key normalization.

  This reduces sync churn by centralizing the fragile name-convention logic in the published package instead of scattering it across synced local files.

- d3d5be1: Implement isolated migration journals per plugin workspace and add database diagnostics tools.

  - `api/src/db/migration-storage.ts` — new shared helper that derives a stable slug from the workspace `package.json` name and provides isolated journal table naming (`drizzle.__drizzle_migrations_<slug>`).

  - `api/src/db/migrate.ts` — runtime migrator now accepts an optional `MigrationStorage` config. When provided, uses the isolated journal table. A preflight table-existence check auto-records migrations as applied when their target tables already exist in the `public` schema, handling legacy journal locations (`public.drizzle_migrations`) and missing journals without hash import. Exports `detectDrift()` that checks whether expected tables from migration SQL exist in the `public` schema and classifies the result.

  - `api/src/db/layer.ts` — resolves migration storage on startup, logs the journal table in use, and fails with a clear drift error when the journal says "applied" but tables are missing.

  - `api/drizzle.config.ts` — adds `migrations.schema` and `migrations.table` to keep Drizzle CLI aligned with the runtime journal table.

  - `packages/everything-dev/src/cli/db-doctor.ts` — new CLI command (`bos db doctor <plugin>`) that inspects a plugin's isolated migration journal, local migration files, and expected tables, then reports health diagnosis.

  - `packages/everything-dev/src/cli/db-repair.ts` — new CLI command (`bos db repair <plugin>`) that resets the isolated journal table and reapplies migrations via `drizzle-kit migrate`. Refuses automatic repair for partial drift or unhealthy states.

  - `packages/everything-dev/src/contract.ts`, `contract.meta.ts`, `plugin.ts`, `cli.ts` — wiring for the two new commands.

  - `packages/everything-dev/src/cli/db-studio.ts` — generated remote drizzle configs now include the matching `migrations` block.

  - `packages/everything-dev/src/cli/sync.ts` — adds `api/src/db/migration-storage.ts` to framework-owned sync files. Plugins with `src/db/` directories automatically receive the new helper.

  - `packages/everything-dev/src/cli/init.ts` — child projects get `db:doctor` and `db:repair` root scripts.

  - `api/tests/unit/migration-storage.test.ts` — covers slug derivation, table naming, legacy candidates, and expected table extraction from SQL.

  Migration drift detection: when `api/src/db/layer.ts` detects the journal has applied hashes but expected tables are missing, startup fails with a specific error pointing to `bos db doctor` and `bos db repair`.

### Patch Changes

- ea699cd: Improve database error visibility and migration diagnostics:

  - `api/src/lib/context.ts` — `flattenError` helper walks nested Error.cause chains so Drizzle/pg errors include the real underlying reason instead of just the SQL wrapper message. Mirrored to `plugins/_template/src/lib/context.ts` and `plugins/apps/src/lib/context.ts`.

  - `api/src/db/migrate.ts` — `loadMigrations()` now logs migration source (virtual/disk) and count; `migrate()` returns the number of applied migrations.

  - `api/src/db/layer.ts` — logs precise migration status (applied/total/source) and warns when zero migrations are found.

  - `api/src/db/index.ts` — adds pool-level error listener for surfacing unexpected pg errors; makes `close()` idempotent.

  - `host/src/program.ts` — actually emits the `formatORPCError` output instead of discarding it.

  - `api/tests/unit/context.test.ts` and `api/tests/unit/db.test.ts` — cover cause-chain flattening and database error unwrapping.

## 1.47.3

### Patch Changes

- ef9a319: Sync `api/src/global.d.ts` (virtual drizzle migrations type declaration) from template to child projects with API, and into each plugin's `src/global.d.ts`.

## 1.47.2

### Patch Changes

- 51ee485: Fix non-fast-forward push failure in Deploy and Staging workflows. The `Commit and push bos.config.json updates` step used a naive `git push` that failed when `main` moved forward during the ~80s deploy run. Ported the retry-with-rebase pattern from the template workflows: up to 3 attempts of `git pull --rebase` + `git push` with 3s sleep between attempts.

## 1.47.1

### Patch Changes

- ff101b0: Gate strict `bun audit` failure behind `AUDIT_STRICT` GitHub secret instead of a `workflow_dispatch` input. The audit step now fails CI on critical/high vulnerabilities when `AUDIT_STRICT=true` is set in repo secrets (works on all run types: push, PR, manual dispatch). Without the secret, it warns only — preserving the previous default behavior. Also fix a latent `set -e` bug: GitHub Actions' default shell aborts on non-zero exit codes, so `bun audit` returning 1 (vulnerabilities found) killed the script before the `AUDIT_STRICT` gate could run. Changed to `set +e -o pipefail` so the script captures the exit code and branches explicitly. Updated AGENTS.md, LLM.txt, and SECURITY.md to reflect Renovate (not Dependabot/dependency-review-action) as the active dependency vulnerability scanner, and removed stale references to `.npmrc` and axios `package.json` overrides that no longer exist.
- 17291c3: Upgrade Bun from 1.2.20 to 1.3.14 across all GitHub workflows, workflow templates, the root `package.json` `packageManager` field, and the Dockerfile base image. This also resolves the `bun audit` hang (oven-sh/bun#20800) that affected 1.2.20, making the CI audit timeout workaround no longer strictly necessary. Also fix Docker workflow cache exhaustion (`failed to reserve cache`) by switching from GitHub Actions cache (`type=gha`) to registry cache (`type=registry`) stored in GHCR, which has no size limit.
- 17291c3: Fix `bun audit` hang in CI template and parent workflows. Bun 1.2.20 has a known cycle-detection bug (oven-sh/bun#20800) causing `bun audit` to hang indefinitely. Wrapped the audit step with `timeout 120` and `timeout-minutes: 5` so it fails fast instead of blocking CI. Also added `timeout-minutes: 20` to the `Publish with deploy` step in deploy/staging workflows as a backstop against Zephyr interactive auth hangs when all tokens are missing.

## 1.47.0

### Minor Changes

- c8e9fa8: feat: align db migrations with drizzle-kit, combine migrator files

  - Combine load-migrations.ts + migrator.ts into migrate.ts
  - Move migration table to drizzle.\_\_drizzle_migrations (drizzle schema) to match drizzle-kit
  - Auto-migrate legacy drizzle_migrations table to new location on startup (with dedupe guard)
  - Use migration.when for created_at (aligns with drizzle's folderMillis)
  - Add DatabaseError tagged error for typed error handling
  - Fix PGlite driver to use direct PGlite instance instead of (db as any).$client
  - Fix SSL verification (rejectUnauthorized defaults to true, opt-out via env)
  - Add pool limits (max, connectionTimeoutMillis, idleTimeoutMillis)
  - Use Effect.tryPromise + Effect.logInfo instead of Effect.promise + console.log
  - Per-statement error context with migrationTag and statementIndex
  - Sort migrations by idx, hash compat check (12-char + 64-char)
  - Sync db files to plugins only when src/db/ directory exists
  - Add old db files to OBSOLETE_FILES + plugin-level cleanup in upgrade

- 389a15c: feat: restore release workflow, sync api/src/db/ to plugins

  - Remove `.github/workflows/release.yml` from obsolete files in upgrade — it's a managed sync file now
  - Add `.github/workflows/release.yml` to framework-owned sync files
  - Sync `api/src/db/{index,layer,migrator,load-migrations}.ts` into each plugin's `src/db/` on sync
  - Update `isFrameworkOwnedSyncFile` to recognize plugin-level db files

## 1.46.2

### Patch Changes

- 88e02ad: Fix dead code in CLI publish/deploy error handlers (generic error check fired before specific handlers, hiding per-workspace failure details). Surface build errors as `warnings` in `WorkspaceDeployResult` when Zephyr deploys successfully with non-zero exit code. Tighten Zephyr error regex from `/ZE\d+/` to `/ZE\d{4,}/` to avoid false positives. Preserve original error context when retrying workspace builds. Reorder deploy URL check before ZE error check for more reliable detection.

## 1.46.1

### Patch Changes

- d65d5ed: Don't treat non-zero rspack exit codes as deploy failures when Zephyr deployed successfully (`[BOS_DEPLOY]` lines are present).
- 28b644b: Warn when `[BOS_DEPLOY]` lines are present but rspack exited with errors. Add `DrizzleORMMigrations` plugin and `pg`/`@electric-sql/pglite` externals to plugin rspack configs by default.
- 80b489d: Fix CI build failure caused by tsdown shebang plugin race condition in dual-format unbundle mode.

## 1.46.0

### Minor Changes

- 5a04915: Improve `bos publish --deploy` output, parallelism, and failure detection:

  - Add `--verbose` flag to `publish` and `deploy` commands for full build output
  - Default (non-verbose) mode shows clean per-workspace summary with timing
  - Parallelize non-host workspace builds (UI, API, plugins run concurrently)
  - Detect Zephyr upload failures (ZE errors) and abort publish instead of silently publishing stale URLs
  - Auto-retry once on transient Zephyr network errors
  - Pre-flight NEAR signing and CLI checks before builds to fail fast
  - Better NEAR transaction error messages with actionable hints
  - Deploy result files (`.bos/deploy-results/`) eliminate `bos.config.json` write races during parallel builds
  - `plugins/<id>/rspack.config.js` is now a framework-owned sync file (updated via `bos sync`)

  Refactor `plugin.ts` (2,572 lines) into focused modules:

  - `build.ts` (538 lines): workspace build orchestration — `buildWorkspaceTargets`, `buildOneWorkspace`, `runBuildAttempt` with Zephyr auth detection, `buildEverythingDevQuietly`, `buildEveryPluginQuietly`
  - `publish.ts` (303 lines): NEAR/FastKV publishing — `publishToFastKv`, `waitForPublishedConfig`, `formatNearError`, `extractTransactionHash`
  - `code-artifacts.ts` (40 lines): `generateCodeArtifacts` extracted to break circular dependency
  - Extract `padRight` to `utils/string.ts`
  - Consolidate `formatDuration` in `cli/timing.ts`, removing duplicate
  - Unexport `buildCommands`, `WorkspaceTarget`, `resolveWorkspaceTarget` (internal-only)

### Patch Changes

- 9497062: Fix deploy result capture by switching from env-var-based (`BOS_DEPLOY_RESULT_DIR`) to stdout-based parsing (`[BOS_DEPLOY]` lines):

  - Add `reportDeployResult` and `parseDeployLines` to integrity.ts — build configs print structured deploy info to stdout, orchestrator parses it instead of reading deploy result files
  - Remove `writeDeployResult`, `readDeployResults`, `readAllDeployResults`, `cleanDeployResultDir` (and `BOS_DEPLOY_RESULT_DIR` env var)
  - Remove `label` field from `DeployResultEntry` (unused)
  - Refactor all 5 build configs (`host`, `ui`, `api`, `apps`, `template`) to use `reportDeployResult`, deleting ~150 lines of duplicated `updateBosConfig`/`updateHostConfig` logic
  - Fix `run.ts` — when `capture: true` + `onChunk` are both used, accumulate chunks in-memory to avoid empty stdout/stderr (stream flowing mode conflict with execa)
  - Fix `extractPublishedUrl` to match Zephyr deploy pattern first for more reliable extraction
  - Strip `deployEntries` field from `deployResults` array (internal-only, not part of `WorkspaceDeployResult` schema)

## 1.45.0

### Minor Changes

- 740ecc6: Improve `bos publish --deploy` output, parallelism, and failure detection:

  - Add `--verbose` flag to `publish` and `deploy` commands for full build output
  - Default (non-verbose) mode shows clean per-workspace summary with timing
  - Parallelize non-host workspace builds (UI, API, plugins run concurrently)
  - Detect Zephyr upload failures (ZE errors) and abort publish instead of silently publishing stale URLs
  - Auto-retry once on transient Zephyr network errors
  - Pre-flight NEAR signing and CLI checks before builds to fail fast
  - Better NEAR transaction error messages with actionable hints
  - Deploy result files (`.bos/deploy-results/`) eliminate `bos.config.json` write races during parallel builds
  - `plugins/<id>/rspack.config.js` is now a framework-owned sync file (updated via `bos sync`)

## 1.44.1

### Patch Changes

- 23479fb: Dev startup performance improvements

  - Parallelize npm registry version checks in `bos status` (was sequential)
  - Run `warnIfOutdated` concurrently with dev startup instead of blocking it
  - Parallelize `buildEveryPluginQuietly` and `buildEverythingDevQuietly` builds
  - Parallelize plugin resolution in `resolveRuntimePlugins` and `resolveConfigComposableEntries`
  - Parallelize contract bridge plugin source resolution in `syncApiContractBridge`
  - Skip redundant `loadResolvedConfig` call when no install or build occurred
  - Add in-memory GET response cache to `http-client` (30s TTL) to eliminate duplicate HTTP fetches
  - Remove redundant `ensureEnvFile`/`loadProjectEnv` calls in dev and start handlers
  - Guard `loadProjectEnv` to only load `.env` once per config directory
  - Memoize `findConfigPath` directory walk results
  - Precompute sorted command catalog instead of sorting on every invocation
  - Remove 0-2s random jitter from remote probe startup
  - Add timing summaries to `bos dev` output
  - Fix FastKV config fetches to use retry logic (was falling to no-retry path on transient errors)

- 23479fb: Fix `bos init` plugin file copy when plugin key differs from directory name

  - `buildInitPatterns` now accepts a `pluginDirMap` to resolve plugin keys to actual directory names
  - During init, the plugin's `development` field from parent config is inspected to detect when the on-disk directory name differs from the plugin key (e.g. `template` key → `_template` directory)

- 23479fb: Fix permanent hang when local dev process probe deadline expires

  `spawnDevProcess` in `orchestrator.ts` probed the local HTTP readiness endpoint every 200ms with a 90s deadline. When the deadline expired, the probe fiber exited silently without calling `markError` or failing `readyDeferred` — unlike `spawnRemoteProbe`, which correctly marks the error after its deadline. If the process was running but never became ready (e.g., stuck compilation, port mismatch, unrecognized log format), `waitForReady` hung forever, permanently blocking host startup.

  - Call `markError` after the 90s probe deadline, mirroring `spawnRemoteProbe`
  - Handle `port <= 0` case — deadline fiber now runs regardless of port, preventing hang when readiness depends solely on log patterns
  - Add 120s `Effect.timeout` on `awaitReady` in `dev-session.ts` as defense in depth, with error logging so users see when a dependency fails or times out
  - Guard against empty auth URL in `config.ts` — skip auth probe when both `url` and `localPath` are empty (same guard plugins already had), preventing a 60s wasted probe on relative URLs
  - Consolidate error-marking logic into `markError` helper (was duplicated 4x)
  - Add idempotency guards to `spawnRemoteProbe`'s `markReady`/`markError` (matching `spawnDevProcess`)
  - Move probe timeout/backoff/deadline constants to module level

## 1.44.0

### Minor Changes

- c1d9cc7: Add shared Effect-based HTTP client, fix missing timeouts and silent error swallowing

  Created `http-client.ts` — a shared fetch utility using `Effect.tryPromise`, `Data.TaggedError`, `Effect.retry`, and `Schedule.exponential` for consistent timeout, retry, and error handling across all CLI network calls.

  Fixes three P0 issues (no timeout — could hang indefinitely):

  - `cli/init.ts` GitHub tarball download: no timeout → added 60s via `fetchResponse`
  - `integrity.ts` SRI hash compute/verify: no timeout → added 30s via `fetchResponse`
  - `mf.ts` Module Federation lifecycle hooks: no timeout → added 15s via inline `AbortController`

  Refactored all fetch call sites to use the shared utility via `Effect.runPromise`:

  - `fastkv.ts` — `fetchJson` and `fetchRemotePluginManifest` replaced with `fetchJsonOrNull`
  - `api-contract.ts` — `fetchWithTimeout` replaced with `fetchResponse`; error messages now include URL
  - `config.ts` — `resolveRemotePluginRuntimeName` replaced with `fetchJsonOrNull`, fixing timer leak
  - `cli/status.ts` — `fetchLatestNpmVersion` replaced with `fetchJsonOrNull`

  Error handling improvements:

  - `plugin.ts:1542` — empty `catch {}` now logs a warning on parent config fetch failure
  - `config.ts:213` — re-thrown error now uses `{ cause: error }` to preserve stack trace
  - `api-contract.ts:92,140,182` — fetch error messages now include the URL being fetched

### Patch Changes

- e2407fc: Fix docker-compose port switching with many plugins

  - `resolvePort` now uses `basePort` as a floor to prevent port regression
  - Stale port entries from removed plugins are pruned on each run
  - Database and Redis secrets are sorted by slug for deterministic assignment
  - `.bos/infra-state.json` is no longer gitignored, so port assignments persist across clones

- ffce414: Add retry with backoff to FastKV config fetches

  `fetchJson` in `fastkv.ts` had a 10s timeout but no retry logic. A single transient network failure (DNS hiccup, TLS reset, packet loss) would propagate as a fatal error, killing `bos dev` and `bos sync` entirely. This was especially impactful for users in regions with intermittent connectivity to `kv.main.fastnear.com`.

  - Retry up to 3 times on network errors and 5xx responses (1s → 2s → 4s backoff)
  - Do not retry on 4xx (legitimate "not found" returns null as before)
  - Log a warning when all attempts are exhausted

## 1.43.0

### Minor Changes

- 1368467: Remove auto-generated plugin-sidebar system in favor of manual sidebar items in `_layout.tsx`

  Deleted the entire `sidebar.ts` code generator, `SidebarItem`/`SidebarRole` types, all
  `sidebar` fields from config/resolution schemas, the `plugin-sidebar.gen.ts` generated file,
  and all sidebar migration/passthrough logic in the CLI, host runtime, and tenant runtime.
  Sidebar items are now defined inline in `ui/src/routes/_layout.tsx`.

### Patch Changes

- b04966c: Fix remote plugin probe failures from high-latency regions

  Remote plugin health checks in `bos dev` used a 400ms timeout per HTTP probe, which is insufficient for TLS handshakes from regions with high RTT to the CDN (e.g. Pakistan → US edge ~300ms RTT). This caused deterministic failures where the same plugins always failed while others always succeeded, depending on which CDN edge node they routed to.

  - Increase remote probe timeout from 400ms to 5000ms
  - Add 0-2000ms random jitter before first probe to spread concurrent TLS handshakes
  - Add exponential backoff (1s → 1.5x → cap 15s) to polling interval so failing probes ease off instead of hammering
  - Add 10s timeout to host manifest fetch to prevent indefinite hang if CDN is unreachable

## 1.42.2

### Patch Changes

- be9ca5b: fix(db-studio): load .env before resolving plugin database info

  Added `loadProjectEnv()` call in the `dbStudio` handler before
  `resolvePluginDbInfo()` to ensure `.env` is loaded into `process.env`
  before the database URL check. Previously the `.env` load happened in
  the CLI layer after the handler had already returned, causing a
  spurious "missing AUTH_DATABASE_URL" error when the variable was
  actually present in `.env`.

- bbe77d3: Update `bos init` prompt default extends ref from `bos://dev.everything.near/everything.dev` to `bos://dev.everything.near/dev.everything.dev`

## 1.42.1

### Patch Changes

- 71bf090: feat(everything-dev): mark framework-owned files with header warnings

  - Added `api/src/lib/context.ts` to `FRAMEWORK_OWNED_SYNC_FILES` so it gets
    synced by `bos sync` / `bos upgrade`
  - Added "BE CAREFUL MODIFYING THIS FILE" header comments to 12 framework-owned
    source and build config files, directing users to upstream changes at
    https://github.com/nearbuilders/everything-dev

- 9e08c18: feat(everything-dev): sync shared auth/context lib files to every plugin

  - Refactored `api/src/lib/auth.ts` to remove dead `PluginsClient`-dependent
    exports (`AuthPluginClientFactory`, `AuthPluginClient`, `AuthCapableServices`,
    `getAuthClient`), making the file fully shareable across all workspaces
  - Added per-plugin sync in `sync.ts`: `api/src/lib/auth.ts` and
    `api/src/lib/context.ts` are now synced to each local plugin's `src/lib/`
    directory during `bos sync` / `bos upgrade`
  - Added per-plugin `auth-types.gen.ts` generation in `api-contract.ts` for
    each plugin's `src/lib/` directory
  - Updated `plugins/_template` and `plugins/apps` to import auth/context
    from their local `./lib/auth` and `./lib/context`
  - Fixed merge conflict markers in `host/src/lib/auth.ts` and
    `host/src/services/auth.ts`

- e1f7ff7: fix(everything-dev): restore full AuthRequestContext type from auth plugin contract

  The generated AuthRequestContext type was overriding the full organization
  envelope (member, org metadata, isPersonal, hasOrganization) from the auth
  plugin's getContext() with a narrower { activeOrganizationId } stub. This
  caused type drift between the runtime context and the type system.

  - Remove handwritten organization/apiKey overlay from AuthRequestContext in
    api-contract.ts generator and cli/init.ts scaffold template
  - AuthRequestContext now aliases RawAuthRequestContext directly, preserving
    the full contract shape

  fix(api): add requireOrgRole middleware for organization-level role checks

  Reads context.organization.member.role from the host-injected context.
  No extra round-trips, no type casts, no caching.

  fix(api): remove dead requireUser middleware and AuthenticatedContext type

  requireUser was functionally identical to requireAuth (same condition,
  different error message) and never imported anywhere. AuthenticatedContext
  was defined but never used by any route handler.

  fix(api): correct misleading requireAuth hint

  requireAuth said "Sign in or provide an API key" but never checked for
  API keys. Now says "Sign in to continue". Only requireAuthOrApiKey
  accepts either auth method.

  feat(api): requireAuthOrApiKey now accepts optional permission checks

  requireAuthOrApiKey() — no args, same behavior as before (session or any
  API key). requireAuthOrApiKey({ resource: ["action"] }) — session passes
  through without permission checks, API key requests are scoped to the
  specified permissions. Call site updated to requireAuthOrApiKey().

  fix(host): remove redundant AuthServices interface

  interface AuthServices extends GeneratedAuthServices { auth: ... } re-declared
  auth with the same inherited type. Replaced with type AuthServices = GeneratedAuthServices.

  fix(\_template): remove requireAuth from scaffold plugin

  The template's requireAuth only checked context.userId (not context.user)
  and its userId re-set was a no-op. getById is now public.

## 1.42.0

### Minor Changes

- 047a2d1: Add `bos db:studio [plugin]` command for local and remote plugin databases. Opens Drizzle Studio for any plugin with a `_DATABASE_URL` secret. For local plugins (like `api` with `development: "local:api"`), runs drizzle-kit from the workspace. For remote plugins (like `auth` via `extends: "bos://..."`), introspects schema from the live database via `drizzle-kit pull`, then opens Studio. Default plugin is `api` for backward compatibility.

### Patch Changes

- 7cb0733: Remove `settings` and `projects` plugins, UI routes, and related component. Replace plugin IDs in tests with `example`.
- bb8410e: Fix integrity monitor false positives for extended remotes. When a composable entry (auth, plugin) uses `extends`, its integrity hash is resolved from the parent config at startup. If the parent is redeployed, the running host's monitor checked against the stale hash. Now stores `extendsRef` on RuntimeConfig entries so the monitor can re-fetch the parent config from FastKV to get the latest integrity before verifying. Also runs the first integrity check immediately instead of waiting for the first interval tick.
- 3733ef7: Rename `api/src/lib/plugins.ts` to `api/src/lib/context.ts`. Extract `ContextSchema` as a shared Zod schema with derived `Context` type, replacing the inline schema in `createPlugin`. Add old path to `OBSOLETE_FILES` in upgrade.
- 4772e1f: Simplify API to a thin orchestration layer: replaces the upvotes table with a `things` registry (`thingId`, `pluginId`, `createdAt`, `updatedAt`), adds Effect service layers (Registry, Votes), and introduces plugin dispatch via `getThingProvider()` so the API delegates to plugins by `pluginId`. Adds `createThing`, `getThing`, `deleteThing` (admin-only), `subscribeThings` endpoints with SSE filtering by `pluginId`/`type`/`action`. Adds `deleteThing` to `_template` plugin contract/service/handler. Extracts `ApiContextSchema`, `pluginContext`, `runEffect` into `lib/context.ts`. Renames service files `thing-registry`→`registry`, `thing-votes`→`votes` with matching symbol renames. Removes obsolete `lib/plugins.ts`. Adds frontend thing registry routes under `/things/` (index, create, detail with vote controls, admin delete, live SSE stream). Improves DB Layer with idempotent migrator. Updates api-and-auth and plugin-development skill docs.

## 1.41.0

### Minor Changes

- d46dbee: Pass full organization and NEAR context from host to plugins

  The host's `buildPluginContext()` now forwards the complete `organization`
  and `near` objects from the auth plugin's `getContext()`, not just the
  flat `organizationId` and `walletAddress` strings.

  **Host:**

  - Store full `contextResult.organization` and `contextResult.near` in
    Hono context variables during session middleware
  - Pass both objects through `buildPluginContext()` to all plugins

  **API plugin:**

  - Add `organization` and `near` zod schemas to the context schema so
    routes and middleware can access org metadata (including `daoAccountId`
    from `organization.organization.metadata`) and NEAR capabilities

  **Template & Settings plugins:**

  - Expand context schema to reflect the full surface of available fields:
    `user`, `organization` (with `organization`, `member`, `isPersonal`,
    `hasOrganization`), `near` (with `primaryAccountId`, `linkedAccounts`,
    `hasNearAccount`), `walletAddress`, and `apiKey`
  - Added documentation comment listing all available context fields

  **CLI (everything-dev):**

  - Fix type error in `resolveRemoteConfigChain` where `BosConfig` was
    passed as `BosConfigInput` to `mergeBosConfigWithExtends`
  - Update plugin-development SKILL.md with a comprehensive Request Context
    Reference section documenting all fields, common patterns, and the
    minimal context pattern

## 1.40.0

### Minor Changes

- f50e1f4: Add `--remote-plugins` flag to `bos dev` for per-plugin remote toggle

  ```bash
  bos dev --remote-plugins auth,registry
  ```

  Forces specified plugins to use their production URLs even when a local
  development path exists on disk. Useful when working on a subset of
  plugins locally while using deployed versions for others.

  The flag accepts a comma-separated list of plugin IDs and can be combined
  with existing flags like `--host remote` or `--ui remote`. Remote plugins
  appear in the dev view as "(remote) loaded" and are probed via their
  production mf-manifest.json endpoint rather than started as local processes.

  Adds `DEBUG=true` diagnostic traces in the dev handler and orchestrator
  to help troubleshoot plugin resolution and startup issues.

## 1.39.0

### Minor Changes

- f0f78e4: Generate docker-compose.yml and .env.example Redis services for `_REDIS_URL` secrets (e.g. `CACHE_REDIS_URL`), with `redis:7-alpine`, append-only persistence, and `redis-cli ping` healthchecks.

  Persist port assignments to `.bos/infra-state.json` so adding new database or Redis services never shifts existing ports.

  Remove alphabetical sort of additional `_DATABASE_URL` secrets — secrets now follow the order they appear in `bos.config.json`.

  Add `.env` staleness detection: warns when `DATABASE_URL`/`REDIS_URL` values in `.env` differ from the generated `.env.example`.

## 1.38.0

### Minor Changes

- add6cba: Add `--remote-plugins` flag to `bos dev` for per-plugin remote toggle

  ```bash
  bos dev --remote-plugins auth,registry
  ```

  Forces specified plugins to use their production URLs even when a local
  development path exists on disk. This is useful when you only want to
  work on a subset of plugins locally while ignoring others.

  The flag accepts a comma-separated list of plugin IDs and can be combined
  with existing flags like `--host remote` or `--ui remote`.

## 1.37.0

### Minor Changes

- f53c563: Publish raw bos.config.json to FastKV instead of the fully-resolved config

  Previously the publish flow resolved the entire extends chain and baked all
  inherited fields (like `app.host`) into the published config. This prevented
  parent host updates from flowing through to child configs at runtime, since
  the server-side `resolvePublishedRuntime` would see the child's baked-in
  value and skip the parent's current value.

  Now the raw config (what the child explicitly defines) is published with its
  extends field preserved, and the server resolves inherited fields dynamically
  at read time.

  Also adds `resolveRemoteConfigChain` which recursively resolves the extends
  chain from KV, including nested entry extends for app entries (auth, api)
  and plugins — so callers always receive a complete `BosConfig` with all
  inherited fields and nested extends resolved.

  Exports `resolveConfigComposableEntries` and refactors `getTargetedEntry` to
  handle any `app.*` target path generically.

## 1.36.0

### Minor Changes

- f6f83b6: Publish raw bos.config.json to FastKV instead of the fully-resolved config

  Previously the publish flow resolved the entire extends chain and baked all
  inherited fields (like `app.host`) into the published config. This prevented
  parent host updates from flowing through to child configs at runtime, since
  the server-side `resolvePublishedRuntime` would see the child's baked-in
  value and skip the parent's current value.

  Now the raw config (what the child explicitly defines) is published with its
  extends field preserved, and the server resolves inherited fields dynamically
  at read time.

  Also adds `resolveRemoteConfigChain` to fix the `bos start` command, which
  fetches remote configs from KV — it now recursively resolves the extends
  chain so callers always receive a complete `BosConfig` with all inherited
  fields like `app.host` properly populated.

- 7187183: Add code-style agent skill with kebab-case naming, semantic Tailwind, and file/directory naming conventions. Update style requirements in AGENTS.md and child project scaffolding to include kebab-case/lowercase component naming.

## 1.35.5

### Patch Changes

- caf22b7: Stop overwriting CONTRIBUTING.md during `bos sync`/`bos upgrade`

  Remove `CONTRIBUTING.md` from `FRAMEWORK_OWNED_SYNC_FILES` so user-customized
  contributing guides survive sync and upgrade operations. It is still scaffolded
  for new projects via `bos init`.

  Also add a `DO NOT MODIFY` warning to `ui/src/app.ts` with guidance that imports
  within the file must use relative paths (`./lib/...`), never `@/app`.

- caf22b7: Make AGENTS.md child-appropriate after `bos init`/`bos sync`/`bos upgrade`

  Child projects now receive a personalized AGENTS.md that keeps the parent's
  TanStack intent skill mappings but replaces parent-specific instructions with
  content relevant to the child project (quick start, architecture, dev workflow,
  plugin architecture, testing, troubleshooting).

  AGENTS.md is handled as a special file in the sync flow — it is no longer in
  `FRAMEWORK_OWNED_SYNC_FILES`. Instead, the sync generates the expected child
  content from the parent's current skill mappings and compares against the local
  child version, so it only updates when parent skills change.

## 1.35.4

### Patch Changes

- 4318a1d: Publish raw bos.config.json to FastKV instead of the fully-resolved config

  Previously the publish flow resolved the extends chain and baked all inherited
  fields (like `app.host`) into the published config. This prevented parent host
  updates from flowing through to child configs at runtime, since the server-side
  `resolvePublishedRuntime` would see the child's baked-in value and skip the
  parent's current value.

  Now the raw config (what the child explicitly defines) is published with its
  `extends` field preserved, and the server resolves inherited fields dynamically
  at read time.

## 1.35.3

### Patch Changes

- 4229990: Generate docker-compose.yml with origin-based container names and fixed volume names. Containers/volumes are keyed by their `extends` source account (e.g. `auth.everything.near-postgres-auth`) instead of the local project name, so repos sharing the same extends source reuse the same containers and avoid port conflicts. Generated docker-compose.yml is now gitignored.
- 4761f96: Narrow static asset extension regex to prevent false positives on non-asset routes containing dots

## 1.35.2

### Patch Changes

- 35d1272: fix: inherit parent plugins through extends when child doesn't declare plugins

  Previously, `mergeBosConfigWithExtends` always stripped parent plugins, so a child
  config that only extended a parent (without declaring its own `plugins`) would get
  no plugins at all. This broke the common pattern of extending an app for its API
  without also re-listing every parent plugin.

  Now: parent plugins are inherited when the child doesn't have a `plugins` key.
  Child with explicit `plugins: { ... }` still gets only its own (no inheritance).

## 1.35.1

### Patch Changes

- ca7ddf2: Fix: Skip init typecheck tests in CI and run tests before version bump in release workflow

  The `init.typecheck.test.ts` and `init.full.test.ts` tests run `bun install` which
  requires npm packages. When the release workflow runs after a version bump but before
  publish, the bumped versions don't exist on npm yet, causing the tests to fail.

  - Skip `init.typecheck.test.ts` and `init.full.test.ts` in CI (`process.env.CI === "true"`)
  - Move the `Test everything-dev release` step in `.github/workflows/release.yml` to run
    **before** the `changesets/action` step (version bump), so tests run on the current
    published versions rather than unpublished bumped versions.

## 1.35.0

### Minor Changes

- 4bffb87: Auth types template now uses contract-based `InferOutput` instead of hardcoded `better-auth` fallback types, and adds `apiKey` and `organization.activeOrganizationId` overlay fields to `AuthRequestContext` to reflect what the host middleware injects at runtime.
- 4bffb87: Expose `variables` on `api`, `auth`, and `plugins` in `ClientRuntimeConfig`. Previously `variables` was only available in the server-side `RuntimeConfig` and was stripped when building the client config passed to the UI. This meant external consumers calling `getAuthVariables()` would always throw because `runtimeConfig.auth.variables` was `undefined`. Now all three sections (`api`, `auth`, `plugins[id]`) include their `variables` in the client config, allowing UI code to read client-safe config like auth base URLs, SIWN recipients, passkey RP IDs, and plugin-specific settings. `secrets` remains server-only.
- 4bffb87: Rework shared dependency syncing to use resolved config surfaces (`app.api.shared`, `app.auth.shared`, and `plugins.*.shared`) and make host/plugin MF sharing stricter and more explicit. UI module federation sharing is now static, shared-dep conflicts fail loudly, and unresolved exact versions are rejected instead of skipped.

### Patch Changes

- 4bffb87: Update the UI auth client to a single options object that carries `runtimeConfig`, `headers`, and `cspNonce`, remove the deprecated `auth-utils` helper module during upgrades, and drop the direct `@hot-labs/near-connect` dependency from the UI package.

## 1.34.0

### Minor Changes

- d51b221: Expose `variables` on `api`, `auth`, and `plugins` in `ClientRuntimeConfig`. Previously `variables` was only available in the server-side `RuntimeConfig` and was stripped when building the client config passed to the UI. This meant external consumers calling `getAuthVariables()` would always throw because `runtimeConfig.auth.variables` was `undefined`. Now all three sections (`api`, `auth`, `plugins[id]`) include their `variables` in the client config, allowing UI code to read client-safe config like auth base URLs, SIWN recipients, passkey RP IDs, and plugin-specific settings. `secrets` remains server-only.
- d51b221: Rework shared dependency syncing to use resolved config surfaces (`app.api.shared`, `app.auth.shared`, and `plugins.*.shared`) and make host/plugin MF sharing stricter and more explicit. UI module federation sharing is now static, shared-dep conflicts fail loudly, and unresolved exact versions are rejected instead of skipped.

### Patch Changes

- d51b221: Update the UI auth client to a single options object that carries `runtimeConfig`, `headers`, and `cspNonce`, remove the deprecated `auth-utils` helper module during upgrades, and drop the direct `@hot-labs/near-connect` dependency from the UI package.

## 1.33.7

### Patch Changes

- b09b597: Fix NEAR CLI handling for publish and deploy flows in CI, including explicit workflow installation, clearer manual install guidance, and better publish logging.

## 1.33.6

### Patch Changes

- e2f79ca: Fix NEAR publish signing-mode handling, remove duplicate fallback warnings, and keep publish output link-safe while preserving transaction submission and confirmation behavior.

## 1.33.5

### Patch Changes

- bd25354: Fix publish/deploy to wait for FastKV confirmation, stream NEAR transaction output live, and keep the CLI process alive until publish completes.

## 1.33.4

### Patch Changes

- cd4a448: Fix publish/deploy to wait for FastKV confirmation and stream NEAR transaction output live.

## 1.33.3

### Patch Changes

- 36b6cd7: Tighten CSP nonce handling across SSR, hydration, and fallback shells, and fix the BOS viewer bootstrap path.
- 36b6cd7: Restore public plugin RPC routing for the browser API contract and keep SSR/client hydration aligned under strict CSP.

## 1.33.2

### Patch Changes

- 37f4ded: Use the UI asset origin for executable UI assets so remoteEntry and CSS load from the immutable UI deploy while public assets stay root-relative.

## 1.33.1

### Patch Changes

- 3af34db: Version asset URLs to prevent stale-cache chunk failures

  Client boot assets (`remoteEntry.js`, `style.css`, plugin UI remote entries) now include a `?v=<integrity>` query parameter matching the SSR pattern. This ensures browsers and CDNs serve the correct asset set after each deploy, eliminating `ChunkLoadError` caused by cached `remoteEntry.js` referencing async chunks that no longer exist on the upstream deployment.

  Also fixes the `_viewer` regex from invalid `/^/+/` to `/^\/+/`.

## 1.33.0

### Minor Changes

- 8ef8f56: Support nested JSON values (objects, arrays, numbers, booleans) in plugin `variables` config. Previously `bos.config.json` only accepted flat `Record<string, string>` — any nested Zod objects/arrays were silently dropped at config load time. Now variables preserve their full structure through config resolution, runtime loading, and plugin injection, matching what plugin Zod schemas already validate.

### Patch Changes

- 8ef8f56: Replace UI asset 302 redirects with reverse proxy to fix Cloudflare 403 errors

  The host now proxies all UI public assets (images, CSS, JS, fonts, favicons) through the host origin instead of 302-redirecting browsers to the Zephyr CDN. This eliminates cross-origin requests that Cloudflare blocks with 403 errors.

  **Breaking changes:**

  - `RenderOptions.assetsUrl` removed from `everything-dev/ui/types` — assets are now served from the host origin via root-relative paths
  - `RouterContext.assetsUrl` removed from `everything-dev/ui/types` — no longer needed since assets resolve through the host proxy
  - `getRemoteEntryScript()` removed from `everything-dev/ui/head` — use `getRemoteScripts()` which now returns `{ src: "/remoteEntry.js" }`
  - `RemoteScriptsOptions.assetsUrl` removed — `getRemoteScripts()` no longer needs an assets URL
  - `UnderConstruction` component: `assetsUrl` prop removed — images use rspack module imports directly
  - `ClientRuntimeConfig.assetsUrl` now set to the host origin (`requestUrl.origin`) instead of the CDN URL — existing consumers should note this value change

  **What changed:**

  - Host: `isUiPublicAssetPath()` deleted, logic inlined; `redirectUiAssetRequest()` replaced with `proxyUiAssetRequest()` using `proxyRequest()`
  - Host: `renderClientShell()` uses root-relative paths (`/favicon.ico`, `/remoteEntry.js`) instead of CDN URLs
  - Host: Plugin UI `<script>` tags use `/__mf/plugin-ui/${key}/remoteEntry.js` proxy paths
  - Host: `buildRuntimeClientConfig` sets `assetsUrl` to `requestUrl.origin`
  - UI: All `${assetsUrl}/path` references replaced with `/path` root-relative paths
  - UI: `new URL(importedAsset, assetsUrl)` pattern removed — rspack module imports used directly
  - UI: `/skill.md` fetched via root-relative path, no `assetsUrl` construction needed

## 1.32.0

### Minor Changes

- dea876c: Remove `cspNonce` from ClientRuntimeConfig, fix SSR asset URLs, dissolve style-chrome

  - **everything-dev**: Remove `cspNonce` from `ClientRuntimeConfigSchema` (was leaking server-only value to client). Add `cspNonce` to `RouterContext`. Remove from `CreateRouterOptions`.
  - **ui**: Fix SSR asset URL mismatch — server `assetPrefix` now uses `bosConfig.app.ui.production` CDN URL instead of `/`, so imported assets resolve to the same absolute URL on both SSR and client. Dissolve `style-chrome.tsx` into `_layout.tsx`. Remove all `useClientValue` calls for runtime config reads (now use `runtimeConfig` from route context directly). Move `cspNonce` from L1 prop into `RouterContext`. Remove `getCspNonce()` from auth client. Add `runtimeConfig` prop to `UnderConstruction`.
  - **host**: Stop merging `cspNonce` into `runtimeConfig` for client shell.

## 1.31.1

### Patch Changes

- d26ed95: Pass CSP nonce through SSR pipeline and redirect UI assets instead of proxying to fix Cloudflare Error 1000

  **CSP nonce passthrough (production CSP script/style blocking fix):**

  The host generated a CSP nonce per request but never forwarded it to TanStack Router's SSR renderer, causing all inline scripts and styles to be blocked by `script-src 'nonce-...' 'strict-dynamic'` in production.

  - **everything-dev/types**: Add `cspNonce?: string` to `CreateRouterOptions` and `RenderOptions` interfaces
  - **everything-dev/types**: Add `cspNonce` to `RenderOptionsWithApi` (inherited from `RenderOptions`)
  - **ui/router.server**: Forward `cspNonce` to TanStack Router as `ssr: { nonce }` in `createRouter` and `renderToStream`
  - **ui/\_\_root**: Apply `nonce` from `useRouter().options.ssr?.nonce` to the `<style>` tag for base styles
  - **host/program**: Remove `as any` cast from `renderToStream` call — `cspNonce` is now a typed property
  - **host/tests**: Add regression tests verifying nonce appears on `<script>` and `<style>` tags when `cspNonce` is provided

  **Cloudflare Error 1000 fix (static asset 403s):**

  When both the host (Railway behind Cloudflare) and UI deployment (Zephyr Cloud behind Cloudflare) are orange-clouded, server-to-server proxying triggers Cloudflare Error 1000 "DNS points to prohibited IP". Browser requests to Zephyr Cloud work fine; only the host's `fetch()` proxy was blocked.

  - **host/program**: Replace `proxyUiAssetRequest` (server-to-server `fetch` proxy) with `redirectUiAssetRequest` (HTTP 302 redirect). The browser follows the redirect directly to the Zephyr Cloud origin, bypassing the Cloudflare-to-Cloudflare proxy loop
  - **ui/style-chrome**: Prefix rspack-imported `built_on.png` and `built_on_rev.png` with `assetsUrl` from runtime config so images load directly from the UI deployment origin instead of through the host
  - **ui/skill**: Use `assetsUrl` instead of `hostUrl` to fetch `/skill.md` directly from the UI origin
  - **host/tests**: Update `ui-public-assets.test.ts` — all UI asset tests now verify 302 redirect behavior instead of proxied content

- d26ed95: Fix deploy hanging in CI by preventing NEAR CLI from reading stdin and adding early validation for missing private key. Add logging around Railway redeploy and FastKV publish steps.

  - **near-cli.ts**: Change `stdin: "inherit"` to `stdin: "pipe"` in `executeTransaction` when using `sign-with-plaintext-private-key`, preventing the NEAR process from hanging on stdin in CI environments. Fall back to `stdin: "inherit"` only for interactive keychain signing (when a TTY is available).
  - **near-cli.ts**: Add early error when no private key is provided and no TTY is available, instead of silently falling through to `sign-with-keychain` which hangs indefinitely in CI.
  - **near-cli.ts**: Change `installNearCli` from `stdio: "inherit"` to `{ stdin: "ignore", stdout: "inherit", stderr: "inherit" }` to prevent the installer script from reading stdin.
  - **near-cli.ts**: Change `runNearCommand` from `stdio: "inherit"` to `{ stdin: "pipe", stdout: "inherit", stderr: "inherit" }`.
  - **plugin.ts**: Add private key validation in `publishToFastKv` with clear error message when running in a non-TTY environment.
  - **plugin.ts**: Add logging for Railway redeploy: service name, captured output, success/error status, and a message when `RAILWAY_TOKEN` is not set.
  - **plugin.ts**: Add logging for FastKV publish: registry URL, transaction submission, and transaction hash on success.

## 1.31.0

### Minor Changes

- 82db5c4: Add `bos deploy` command, host secrets, and staging environment support

  - **New `bos deploy` command**: Publishes config to FastKV and triggers Railway redeploy in one step. Reads service name from `ci.railway.service` in `bos.config.json`. Uses `RAILWAY_TOKEN` (environment-scoped) instead of deployment IDs.

  - **New `ci` config section**: `bos.config.json` now accepts `ci.railway.service` for Railway integration. Child projects inherit this via extends.

  - **Staging environment support**: `BOS_ENV=staging` or `--env staging` enables staging mode. `staging.domain` overrides `domain`, FastKV publishes under the staging gateway key, and runtime sets `env = "staging"`.

  - **Host secrets**: Added `secrets` array to `app.host` for tenant-related environment variables (`TENANT_WHITELIST`, `ALLOW_OVERRIDE`, `ALLOW_UNTRUSTED_SSR`, `CSP_STRICT`). Validated during `bos start` and surfaced in `bos infra`.

  - **Workflow simplification**: Replaced `publish.yml` with `deploy.yml`. `release.yml` now only handles npm package releases. `staging.yml` uses `bos deploy --env staging`. All workflows use `railway redeploy` via CLI instead of raw GraphQL API calls.

  - **Removed**: `RAILWAY_PRODUCTION_SERVICE_ID` and `RAILWAY_STAGING_SERVICE_ID` variables — replaced by environment-scoped `RAILWAY_TOKEN` secrets.

### Patch Changes

- 82db5c4: Require ssrIntegrity for tenant SSR — prevent no-cache-per-request MF instance creation

  Tenant SSR now requires both `ssrUrl` and `ssrIntegrity` to be present. Previously, a whitelisted tenant with `ssrUrl` but no `ssrIntegrity` would bypass the router module cache (`shouldCacheRouterModule` returns false without `ssrIntegrity`), causing a new Module Federation instance to be created on every SSR request — the same pattern that caused the production SSR failure.

  Also fixes pre-existing typecheck errors in host test files (Effect Either narrowing, FederationError type annotation).

## 1.30.0

### Minor Changes

- 1adfdee: Support account-relative tenant resolution on shared hosts so subdomains derive from the active runtime account instead of `label.near`, and allow nested tenant labels in the resolver and tests. Expose runtime lineage in the apps registry by deriving parent, root, depth, and extendsChain from `extends`, and add registry list filters for parent and root traversal.

### Patch Changes

- 4518cdb: Fix UI-only `bos init` scaffolding so child apps keep the right workspaces, accept `--no-interactive`, and avoid generating API-only type artifacts when no local `api/` workspace exists. Clarify the public TanStack Intent skill docs for UI-only tenant children, including current scaffold caveats and cleanup guidance.
- ea4b5f2: Fix `bos types:gen` to handle remote plugins that only have a `production` URL (no `development`). Plugin contract fetch failures no longer crash the entire type generation — failed plugins are reported and skipped, and the command shows per-plugin fetched/skipped/failed status instead of only API-level status.

## 1.29.0

### Minor Changes

- b662086: Fix sidebar navigation to derive from plugin sidebar items and include projects

  - Updated `ui/src/routes/_layout.tsx` to properly consume generated `pluginSidebarItems` instead of using hardcoded navigation.
  - Fixed `packages/everything-dev/src/sidebar.ts` so the core `home` item points to `/home` (logo/dot still links to `/` for repository markdown render).
  - Added `plugins.projects.sidebar` to `bos.config.json` so the projects plugin appears in generated navigation.
  - Regenerated `ui/src/lib/plugin-sidebar.gen.ts` via `bos types gen` to include the `projects` sidebar item.
  - Fixed unbalanced JSX structure in `_layout.tsx` and removed stale/unused imports.

## 1.28.12

### Patch Changes

- 2681ec9: Make child project config handling less confusing by showing the local `bos.config.json` by default in `bos config` and reserving `--full` for the fully resolved config. Also preserve existing child auth overrides during sync and upgrade, keep child catalogs aligned with the full extends chain, generate only relevant root scripts for each workspace shape, and base sync snapshots on the actual merged file content.

## 1.28.11

### Patch Changes

- 615298a: Pin `@better-auth/core` alongside the Better Auth client packages and teach `bos upgrade` to add the missing catalog ref in child workspaces while resyncing stale `shared.ui` auth versions from the catalog. This prevents duplicate Better Auth core installs from breaking generated auth client plugin types after init or upgrade.

## 1.28.10

### Patch Changes

- ef08a08: Keep generated local infra files in sync across init, sync, dev, and start by using a single env/docker generation path from resolved `bos.config.json` secrets. Also preserve child project package names and default root scripts during upgrade, prevent catalog values from being downgraded by template sync, ensure child workflow files come from `.github/templates`, and make publish workflows always republish runtime config while still using changesets to decide which app modules deploy.

## 1.28.9

### Patch Changes

- cfbc7dd: Keep generated local infra files in sync across init, sync, dev, and start by using a single env/docker generation path from resolved `bos.config.json` secrets. Also preserve child project package names and default root scripts during upgrade while preventing catalog values from being downgraded by template sync.

## 1.28.8

### Patch Changes

- 86ad34e: Fix `asComposableEntry` crash when extends targets a config path (e.g. `#plugins.myplugin` or `#app.auth`) that doesn't exist in the parent config. Previously threw "Expected config entry object, received undefined"; now treats the missing entry as an empty merge, so child-only values stand alone.

## 1.28.7

### Patch Changes

- 6b72cfd: Add fixed-core tenant UI composition for shared hosts so subdomains can resolve BOS configs per request while keeping the host, auth, and API runtime stable. This also hardens tenant remote integrity verification with bounded streaming, background refresh for asset requests, and safer SSR cache invalidation for updated remotes.

## 1.28.6

### Patch Changes

- 63d0f05: Simplify generated child workflows down to `CI` and `Publish`, and split the parent repo's package release flow from runtime publish/deploy. Parent package staging now publishes all non-private `/packages/*` workspaces instead of hardcoding framework package names.

## 1.28.5

### Patch Changes

- df9b55b: Normalize generated child root `package.json` files for app repos, including child-specific scripts and removal of parent-only manifest fields. Child workflow templates now use a `CI` -> `Packages Release` -> `Release` flow, preserve empty `plugins/*` workspace overrides during sync, and pin reusable release deploys to the CI-validated commit SHA.

## 1.28.4

### Patch Changes

- f4970c0: Make `app.ui.name` optional in `BosConfigSchema` to match `app.api` and `app.auth`. Previously `UiConfigSchema` required `name`, causing `Failed to load config` errors when `bos.config.json` omitted it. The UI name now falls back to `package.json` name or `"ui"` at runtime, consistent with other app entries.

## 1.28.3

### Patch Changes

- 0badff3: Update `bos upgrade` to sync inherited catalog entries from the full root `bos.config.json` extends chain, preserve child-only catalog entries, and rewrite matching workspace dependencies to `catalog:`. This also writes fully derived composable/plugin config into the resolved BOS config artifact, adds the shared TanStack UI tooling packages to the root catalog, removes the explicit `@hot-labs/near-connect` pin so apps follow the transitive `better-near-auth` dependency instead, and makes config loading warn and fall back to production when development targets are missing while still erroring on unreachable `extends` targets without a usable local fallback.
- eaad343: Refactor CI/release workflows: rename `release-sync.yml` template to `release.yml` and make it a reusable `workflow_call`, add `fail_on_critical_high` input to CI audit step, split parent release into `publish` + `deploy` jobs calling the template, and clean up obsolete `release-sync.yml` on upgrade. Improve config logging: collect `[Config]` warnings during `loadConfig` and return them in `ConfigResult.warnings` instead of emitting `console.warn` mid-spinner, suppress warnings around direct `buildRuntimeConfig` calls in the plugin runtime, and log `Resolving "app.auth" from bos://...` instead of the generic "No development target" when an `extends` ref is present.

## 1.28.2

### Patch Changes

- dc0e2f5: Fix `bos dev --host remote` so the CLI loads the project `.env` file before it initializes the in-process remote host and plugin runtime, which restores host-side secret injection for auth and other plugins without requiring users to manually export env vars. This also removes the duplicate `Remote Host` status line before the TUI takes over so the startup output only shows the boxed `REMOTE HOST` heading.

## 1.28.1

### Patch Changes

- c10c3fa: Fix the published `bos` CLI when it is launched via Node. The CLI binary is installed with a Node shebang, but the `dev` code path still used `Bun.spawn()` and `Bun.file()`, which caused `Bun is not defined` at runtime. Process execution now uses `execa`, and file reads in the plugin handler now use standard Node filesystem APIs so the distributed CLI works correctly in its packaged runtime.
- c10c3fa: Fix `bos sync` and `bos upgrade` so child `bos.config.json` files keep their existing local root metadata instead of inheriting parent-only fields during template reconciliation. This also prunes stale unresolved plugin entries before runtime type generation, removing spurious `[API Contract] Skipping plugin ... no URL resolved` warnings, and cleans the synced CI workflow by dropping the obsolete integration-test job and gating Docker builds at the job level.

## 1.28.0

### Minor Changes

- 6b7c0da: Use `plugins/*` workspace glob instead of individual `plugins/X` entries in `package.json`. This prevents `bun install` errors when upgrading projects that reference plugin workspaces that don't exist locally. Also removes `docker-compose.yml` from framework-owned sync files (it's now generated dynamically from runtime config). CI workflow templates no longer include the internal `packages/every-plugin` build step and Docker build steps are conditional on `Dockerfile` existing.
- 6b7c0da: Separate CLI presentation from plugin handler logic. Plugin handlers now emit structured progress events via `EventEmitter` instead of calling `@clack/prompts` directly; the CLI adapter subscribes and renders spinners, prompts, and colors. This makes `everything-dev/plugin` platform-agnostic — it can spawn processes and return data, but no longer imports terminal UI libraries.

  - Removed `src/` from package `files` (halves published size) and added `sideEffects: false`
  - Expanded `neverBundle` list: `@clack/prompts`, `@effect/*`, `@orpc/*`, `@standard-schema/*`, `execa`, `defu`, `openapi-types`
  - Removed `plugin` from barrel export (`everything-dev`) — import `everything-dev/plugin` directly
  - `init` handler no longer prompts or shows spinners — CLI handles interactive `docker compose` confirm, parent config confirmation, and live progress via `pluginEvents`
  - `dev`/`start` handlers store session data via `consumeDevSession()` instead of starting Ink UI directly — CLI launches the terminal session
  - `start` handler returns structured `StartSummary` data instead of printing colored output
  - Added `DevResult` and `StartResult` type exports to contract

### Patch Changes

- 6b7c0da: Fix `bos init` plugin selection: choosing "override plugins" but selecting zero plugins now correctly omits all parent plugins instead of defaulting to all of them. The `init` handler previously treated an empty `plugins` array (`[]`) the same as `undefined` ("not specified"), overwriting the user's explicit choice with all parent plugin keys.

## 1.27.0

### Minor Changes

- 521f85e: Fix SSR auth client injection, proxy test mock shape, and test config resolution

  - **host**: Pass `authClient` to SSR `renderToStream` so the host's pre-resolved auth client
    is reused instead of creating a new one from config. Export `toAuthClientContext` for use
    in program.ts. Proxy test mock updated to use correct `initialized.context` shape instead
    of putting handler directly on `initialized`.

  - **everything-dev**: Add optional `authClient` field to `RenderOptionsWithApi` type so
    callers can provide a pre-configured auth client for SSR rendering.

  - **ui**: `renderToStream` now uses `authClient` from render options when provided, falling
    back to `createAuthClient(runtimeConfig)` when not specified.

  - **host/tests**: Replace `process.env`-based `BOS_UI_URL`/`BOS_UI_SSR_URL` with production
    URL fallbacks from `bos.config.json` (`app.ui.production`, `app.ui.ssr`). Add
    `createMockAuthClient` helper returning a null-session auth client for SSR tests. Pass
    `session: null` and `authClient` in test render options to match production SSR semantics.

### Patch Changes

- 1f75d34: Remove `.templatekeep` and `.templatesync-exclude` during `bos upgrade` — these files belong to the deprecated template sync pattern that has been replaced by `bos sync`.
- 212ea6f: Clean up test infrastructure: proxy mock, dead env plumbing, and type cast

  - **host/tests**: Replace 80-line manual `AuthClient` mock with an 8-line
    `Proxy`-based mock that auto-implements any property, making it resilient
    to auth client API changes.
  - **host/tests**: Remove dead `vitest.setup.ts` and its `setupFiles` entry
    from `vitest.config.ts`. The `BOS_UI_URL`/`BOS_UI_SSR_URL` env var
    plumbing was unused after switching `loadTestRuntimeConfig` to read
    production URLs from `bos.config.json`. Simplify `global-setup.ts` to
    just build the UI dist (no HTTP server or env var setup needed).
  - **ui**: Remove unnecessary type cast in `renderToStream` —
    `renderOptions.authClient` is now typed directly via `RenderOptions`.
    Remove unused `AuthClient` type import.

- f78dcb8: Fix `bos init` to scaffold the selected local surfaces directly from the extended repository, and fix `bos upgrade` to take tool versions from the extended repo's root catalog instead of drifting to newer npm releases.
- 46988c0: Require package typecheck and test gates before publishing framework releases, and allow manual release workflow retries even when there are no fresh changesets to consume.

## 1.26.1

### Patch Changes

- 6475dc4: Improve `bos init` prompt copy by renaming the local override question to customization language and adding a confirmation step that shows the parent app title and description when both are available.

  Fix framework install resolution so `bos init` removes copied `bun.lock` files before install and `bos upgrade` uses `bun install --force`, preventing stale lockfile entries from downgrading `everything-dev` away from the intended version.

## 1.26.0

### Minor Changes

- ab62a37: - **Strip inheritable config fields in init and sync**: `bos init` and `bos sync` now strip `title`, `description`, `testnet`, `staging`, and `repository` from the child `bos.config.json`. These are inherited via `extends` — including them caused child projects to show stale parent metadata.
  - **Strip non-overridden app sections and production fields in sync**: Previously `app.host` and `app.auth` leaked into child configs during sync unless explicitly overridden. Now non-overridden sections are removed, and `production`/`integrity`/`ssr` fields are stripped from overridden entries in both init and sync modes.
  - **Remove empty `plugins: {}`**: Empty plugins objects are now deleted instead of preserved, keeping the config clean.
  - **Fix stale catalog versions**: `personalizeConfig` now merges `resolveFrameworkCatalog()` over the copied `package.json` catalog, so all versions match the currently-running CLI instead of the parent template's versions.
  - **Fix upgrade not applying new versions**: `bos upgrade` uses plain `bun install` (without `--ignore-scripts` or `--force`) instead of `bun install --force`. This avoids bumping unrelated transitive dependencies while correctly resolving changed catalog entries.
  - **Restore lockfile-aware init**: Init uses `stripOrphanedWorkspacesFromLockfile` instead of deleting `bun.lock`, preserving dependency resolutions and making installs fast (~seconds instead of minutes).
  - **Carry `.templatekeep` forward**: `readTemplatekeep` always includes `.templatekeep` itself in returned patterns, and `.templatekeep` was added to the root template. Child projects can now run `bos sync` without "No .templatekeep found" errors.
  - **Add convenience `bos` script**: Both `personalizeConfig` and `scaffoldMinimalProject` add `"bos": "node_modules/.bin/bos"` to `package.json` scripts for `bun run bos <command>`.

### Patch Changes

- fb7e711: Fix child plugin workspace selection during init and sync by replacing `plugins/*` with the concrete selected plugin workspaces and ensuring stripped plugin config is written back to `bos.config.json`.

  Add integration coverage for real parent config personalization, plugin-owned file selection, and sync ownership rules so init/sync reliably preserve app-owned files while keeping framework-owned files in sync.

## 1.25.0

### Minor Changes

- b84cfaa: - **Strip inheritable config fields**: `bos init` no longer duplicates `title`, `description`, `testnet`, `staging`, or `repository` from the parent config into the child project. These are inherited via `extends` — including them caused child projects to show stale parent metadata.
  - **Fix stale catalog versions**: `personalizeConfig` now merges `resolveFrameworkCatalog()` over the copied `package.json` catalog, so all package versions (react, better-auth, @orpc/\*, etc.) match the currently-running CLI instead of the parent template's versions.
  - **Fix upgrade not applying new versions**: `bos upgrade` now uses `bun install --force` (without `--ignore-scripts`) instead of deleting `bun.lock`. This forces Bun to re-resolve changed packages from the registry while preserving the lockfile structure, fixing the bug where `everything-dev v1.15.0` persisted after upgrade to `v1.23.0` — without the slow full-lockfile regeneration that caused upgrades to stall.
  - **Carry `.templatekeep` forward**: `readTemplatekeep` now always includes `.templatekeep` itself in returned patterns, and `.templatekeep` was added to the root template. Child projects can now run `bos sync` without "No .templatekeep found" errors.
  - **Add convenience `bos` script**: Both `personalizeConfig` and `scaffoldMinimalProject` now add `"bos": "node_modules/.bin/bos"` to `package.json` scripts, so `bun run bos <command>` works for ad-hoc CLI calls like `bun run bos status`.
  - **Delete stale lockfile during init**: The init flow now deletes `bun.lock` before `bun install`, ensuring a fresh resolution that matches the updated catalog.

## 1.24.0

### Minor Changes

- e018b05: - **Strip inheritable config fields**: `bos init` no longer duplicates `title`, `description`, `testnet`, `staging`, or `repository` from the parent config into the child project. These are inherited via `extends` — including them caused child projects to show stale parent metadata.
  - **Fix stale catalog versions**: `personalizeConfig` now merges `resolveFrameworkCatalog()` over the copied `package.json` catalog, so all package versions (react, better-auth, @orpc/\*, etc.) match the currently-running CLI instead of the parent template's versions.
  - **Fix upgrade not applying new versions**: `bos upgrade` now deletes `bun.lock` before running `bun install` and runs install without `--ignore-scripts`. This forces Bun to re-resolve dependencies instead of reusing stale lockfile entries, fixing the bug where `everything-dev v1.15.0` persisted after upgrade.
  - **Carry `.templatekeep` forward**: `readTemplatekeep` now always includes `.templatekeep` itself in returned patterns, and `.templatekeep` was added to the root template. Child projects can now run `bos sync` without "No .templatekeep found" errors.
  - **Add convenience `bos` script**: Both `personalizeConfig` and `scaffoldMinimalProject` now add `"bos": "node_modules/.bin/bos"` to `package.json` scripts, so `bun run bos <command>` works for ad-hoc CLI calls like `bun run bos status`.
  - **Delete stale lockfile during init**: The init flow now deletes `bun.lock` before `bun install`, ensuring a fresh resolution that matches the updated catalog.

## 1.23.0

### Minor Changes

- 24314cc: Fix `bos init` hanging during "Installing dependencies...":

  - **Populate full catalog**: Read `workspaces.catalog` from the running CLI's monorepo root and include all 42 entries, so workspace `catalog:` references resolve. Previously the minimal scaffold wrote an empty catalog, causing Bun to hang on resolve.
  - **Seed lockfile**: Add `bun.lock` to `.templatekeep` so the template lockfile is copied during init, giving Bun a warm start instead of resolving everything from scratch.
  - **Strip orphaned workspaces from lockfile**: New `stripOrphanedWorkspacesFromLockfile` removes workspace entries (e.g. `host`, `packages/*`, `plugins/*`) that don't exist in the scaffolded project, preventing resolution errors.
  - **Call `personalizeConfig` in minimal scaffold path**: The minimal scaffold was skipping config personalization, leaving `postinstall` and `types:gen` scripts pointing at the monorepo paths instead of `node_modules/.bin/bos`.
  - **Elapsed-time spinner**: `runBunInstall` and `runTypesGen` now update the spinner with elapsed seconds (e.g. "Installing dependencies... (8s)") while running.
  - **Stream command output**: `bun install`, `bos types gen`, and `docker compose up` now stream their output via `stdio: "inherit"` instead of swallowing it.
  - **Command timeouts**: `execCommand` now applies timeouts (5 min for bun/docker, 1 min for tar, 2 min default) so a hung process can't block the CLI forever.
  - **`fetchRemotePluginManifest` timeout**: Added 10s `AbortController` timeout matching the existing `fetchJson` pattern.
  - **Tests**: New `init.install-progress.test.ts` validates catalog population and lockfile workspace stripping.

## 1.22.0

### Minor Changes

- b0b7b8b: Fix `bos init` hanging during "Installing dependencies..." on minimal scaffolds (no template repository):

  - Populate `workspaces.catalog` with resolved framework versions so `catalog:` deps can be resolved by Bun. Previously the catalog was empty, causing `bun install` to hang or fail silently.
  - Call `personalizeConfig` in the minimal scaffold path so scripts, workspace refs, and gen-file stubs are created — matching the behavior of the full template path.
  - Stream output from `bun install`, `bos types gen`, and `docker compose up` instead of piping to `/dev/null`, so install progress and errors are visible.
  - Add timeouts to `execCommand` calls (5 min for bun/docker, 2 min default) so a hung command can't block the CLI forever.
  - Add a 10s timeout to `fetchRemotePluginManifest` to match the existing `fetchJson` timeout pattern.

## 1.21.0

### Minor Changes

- 52bb6cd: Add `bos init` support for extending any deployed app. The `--extends` flag now accepts `bos://account/gateway` or `account/gateway` shorthand to extend any published app. When the parent config has no `repository`, `bos init` walks the `extends` chain to find one, then falls back to a minimal scaffold inheriting the parent runtime config. Removed `--extends-account` and `--extends-gateway` in favor of the single `--extends` flag. Init now shows progress labels for each phase (fetching config, resolving source, copying files, installing deps, etc.) instead of a single stalled spinner. Outdated package warnings now only show for `everything-dev` and `every-plugin` (framework packages), not transitive deps like rspack or module-federation.
- 52bb6cd: Replace `--withHost` with `--overrides` flag for `bos init`. The new `--overrides` flag accepts a comma-separated list of sections to include locally: `ui`, `api`, `host`, `plugins`. Default is `ui,api` — a minimal config that inherits everything else from the parent at runtime. Use `--overrides=ui,api,host,plugins` to match the old `--withHost` behavior. Specifying `--overrides=plugins` (with or without `--plugins`) controls which plugins get local source. Plugin inheritance via `extends` works without local overrides — `--overrides=plugins` is only needed for local plugin development. Also adds automatic `repository` detection from git remote and produces a minimal `bos.config.json` by default.

## 1.20.0

### Minor Changes

- ebbbffa: Add `bos init` support for extending any deployed app. The `--extends` flag now accepts `bos://account/gateway` or `account/gateway` shorthand to extend any published app. When the parent config has no `repository`, `bos init` walks the `extends` chain to find one, then falls back to a minimal scaffold inheriting the parent runtime config. Removed `--extends-account` and `--extends-gateway` in favor of the single `--extends` flag. Init now shows progress labels for each phase (fetching config, resolving source, copying files, installing deps, etc.) instead of a single stalled spinner.

### Patch Changes

- ebbbffa: Reverted catalog dependencies to stable versions:

  - @rspack/core: 2.0.3 → 1.7.11
  - @rspack/cli: 2.0.3 → 1.7.11
  - @rsbuild/core: 2.0.6 → 1.7.5
  - @rsbuild/plugin-react: 2.0.0 → 1.4.6
  - @module-federation/enhanced: 2.4.0 → 2.3.2
  - @module-federation/node: 2.7.42 → 2.7.40
  - @module-federation/rsbuild-plugin: 2.4.0 → 2.3.2
  - @module-federation/runtime-core: 2.4.0 → 2.3.2
  - @module-federation/sdk: 2.4.0 → 2.3.2
  - @module-federation/dts-plugin: 2.4.0 → 2.3.2

  The 2.0 rspack/rsbuild and 2.4 module-federation upgrades introduced breaking
  dev-server middleware API changes that broke plugin hot-reload. Reverting to
  the last known-good 1.7.x / 2.3.2 line until the ecosystem stabilizes.

## 1.19.0

### Minor Changes

- 2047ace: Add `bos init` support for extending any deployed app. The `--extends` flag now accepts `bos://account/gateway` or `account/gateway` to extend any published app, not just the default template. When the parent config has no `repository` field, `bos init` walks the `extends` chain to find one, then falls back to a minimal scaffold (just `bos.config.json`, `package.json`, `.env.example`, `.gitignore`) inheriting the parent's runtime config. Removed `--extends-account` and `--extends-gateway` in favor of the single `--extends` flag.

### Patch Changes

- 27bfb06: fix(ci): restore empty `NODE_AUTH_TOKEN` env var for npm provenance publishing

  Commit `4c72604` removed `NODE_AUTH_TOKEN` from the npm publish steps when switching to OIDC trusted publishing. However, `actions/setup-node` with `registry-url` generates an `.npmrc` containing `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`. When this env var is completely absent, npm fails with `OIDC publish authorize: Invalid token` because the `.npmrc` placeholder is unresolved.

  Restoring `NODE_AUTH_TOKEN: ""` satisfies the `.npmrc` syntax while allowing npm to fall through to the GitHub OIDC token for `--provenance` authentication.

## 1.18.0

### Minor Changes

- faa99d6: Eliminate per-plugin `bos.config.json` files. All plugin metadata (secrets, variables, routes, sidebar, production URLs) now lives directly in root `bos.config.json` under `plugins.<key>`. Plugin rspack configs write deployment URLs to root config. `extends` support remains for cross-app composition. `bos upgrade` migrates plugin configs into root and deletes them.

## 1.17.0

### Minor Changes

- e4e6e3a: Add targeted `extends#path` support for composable app entries, move plugin provider metadata onto `plugins.<id>` entries, and migrate `bos init`/`bos upgrade` to the new plugin config shape. This also fixes local plugin path resolution during scaffolding so selected plugins are copied and wired correctly, including the no-plugins init path.

## 1.16.3

### Patch Changes

- d5b4f00: Lazy-load the dev runtime so `bos types gen` does not pull in `@effect/platform-node` during CLI startup, and add regression coverage for init-generated projects running type generation after install.
- d5b4f00: Stop inheriting parent plugins through `extends`, remove the fake plugin registry path, make `bos upgrade` offer new parent plugins as an explicit opt-in, and fix `bos init` to generate `.env.example`, `.env`, and `docker-compose.yml` from resolved secrets. Also speed up `bos init` by removing duplicate codegen, add timeouts to remote contract fetches, and print per-phase timing summaries for `bos init` and `bos upgrade`.

## 1.16.2

### Patch Changes

- 33bd84e: Stop inheriting parent plugins through `extends`, remove the fake plugin registry path, make `bos upgrade` offer new parent plugins as an explicit opt-in, and fix `bos init` to generate `.env.example`, `.env`, and `docker-compose.yml` from resolved secrets.

## 1.16.1

### Patch Changes

- 0e1c067: Stop inheriting parent plugins through `extends`, remove the fake plugin registry path, and make `bos upgrade` offer new parent plugins as an explicit opt-in.

## 1.16.0

### Minor Changes

- 4bd76f7: Remove hardcoded plugin list and fix bos.config.json field ordering

  - **Dynamic plugin discovery**: The `AVAILABLE_PLUGINS` hardcoded array (containing only "settings") is gone. Plugin options are now discovered from the parent config's `plugins` key, so `bos init` shows whatever plugins the parent template actually offers.

  - **Removed `["settings"]` fallback**: `bos init` no longer defaults to `["settings"]` when no plugins are specified. The user selects plugins or gets none.

  - **Fixed config field ordering**: `title` and `description` are now placed after `domain` in `bos.config.json` (was: after `shared`), matching the intended order: `extends → account → domain → title → description`.

  - **Fixed plugin leakage during sync/upgrade**: `personalizeConfig` now correctly filters out unwanted plugins when `opts.plugins` is an empty array (previously skipped filtering, letting all parent plugins through).

  - **Removed `plugins/settings/**`from`.templatekeep`**: Plugin source files are no longer hard-coded into the template; only `plugins/\*/bos.config.json` is included so init/sync can set up plugin configs for selected plugins.

### Patch Changes

- 4bd76f7: Replace `node:child_process` spawn with `shell: true` by `execa` for cross-platform command execution, eliminating the DEP0190 deprecation warning

## 1.15.0

### Minor Changes

- 81f2599: Add `title` and `description` fields to `bos.config.json`, runtime config, and `ClientRuntimeInfo`. SEO head metadata now reads `title`/`description` from `runtimeConfig.runtime` instead of hardcoded defaults. Also removes a debug console.log, fixes an outdated comment in app.ts, adds a Dockerfile comment, and adds a workflow comment for FCAK creation.

## 1.14.4

### Patch Changes

- 81f90a3: Fix `bos upgrade` to create missing catalog entries for tool packages (rspack, rsbuild, module-federation). Previously `updateRootCatalogVersion` skipped packages not already in the catalog, causing `catalog:` refs to resolve to nothing and `bun install` to fail with "failed to resolve" errors.

## 1.14.3

### Patch Changes

- 5599b35: Remove dead modules and unused sub-path exports

  Delete `src/host.ts`, `src/api.ts`, and `src/federation.server.ts` — superseded by the `host/` workspace with zero consumers.

  Remove `./api`, `./host`, `./orchestrator`, and `./shared` sub-path exports from package.json (no external consumers).

  Remove `@hono/node-server`, `hono`, `@orpc/contract`, `@orpc/openapi`, `@orpc/server`, and `@orpc/zod` from dependencies (no runtime references remain). Update tsdown.config.ts accordingly.

## 1.14.2

### Patch Changes

- b7cf8f3: Remove dead host, api, and federation.server modules

  Delete `src/host.ts` (573-line Hono server), `src/api.ts` (181-line plugin loader), and `src/federation.server.ts` (43-line SSR module loader). These were superseded by the `host/` workspace and had zero consumers.

  Also removes the `./api` and `./host` sub-path exports from package.json, and drops `@hono/node-server`, `hono`, `@orpc/contract`, `@orpc/openapi`, `@orpc/server`, and `@orpc/zod` from dependencies (no runtime references remain).

## 1.14.1

### Patch Changes

- 8d2a27e: Consolidate code generation into `generateCodeArtifacts` — single function replaces scattered `writeResolvedConfig`, `writePluginSidebarGen`, and `syncApiContractBridge` calls across all CLI handlers (dev, start, build, publish, init, sync, typesGen, pluginAdd, pluginRemove, pluginPublish). Fixes CI build failure where `publish --deploy` skipped sidebar generation.
- Fix Docker container `bos: not found` — use explicit path in start script

  The Docker build runs `bun install` before `dist/cli.mjs` exists, so `node_modules/.bin/bos` symlinks are broken. The `start` script now uses `bun ./node_modules/everything-dev/dist/cli.mjs start` directly — no bin symlink dependency.

  Also adds `packages/everything-dev/cli.js` to `OBSOLETE_FILES` so `bos upgrade` cleans it up in child projects.

## 1.14.0

### Minor Changes

- ffa8200: Catalog-ify rspack/rsbuild packages and propagate via bos upgrade/sync

  - Add @rspack/core, @rspack/cli, @rsbuild/core, @rsbuild/plugin-react to root package.json catalog
  - Convert all workspace package.json rspack/rsbuild deps from version ranges to catalog: refs
  - Change every-plugin @rspack/core peerDep from exact 1.7.4 to range ^1.7.4
  - Add CATALOG_TOOL_PACKAGES to manifest-normalizer for catalog: conversion during init/sync
  - Extend bos upgrade to also bump catalog tool packages to latest npm versions
  - Extend bos status to report catalog tool package versions

- 8a441fe: Eliminate cli.js shim — bin entry points directly to dist/cli.mjs

  The `cli.js` shim was a dual-purpose entry that fell back between `dist/` and `src/`, creating a shebang conflict (npm needs `#!/usr/bin/env node`, Bun needed `#!/usr/bin/env bun` for TS). This caused `bunx everything-dev upgrade` to fail with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` because Node can't strip TS from node_modules.

  - Delete `cli.js` — the shim is eliminated
  - `src/cli.ts` shebang → `#!/usr/bin/env node` (tsdown carries it to `dist/cli.mjs`)
  - `bin.bos` → `dist/cli.mjs` (Node-compatible, no fallback needed)
  - Root scripts → `packages/everything-dev/src/cli.ts` (Bun handles TS natively)
  - CI workflows → `packages/everything-dev/src/cli.ts`
  - `init.ts` rewrite rules updated for new script paths

### Patch Changes

- Updated dependencies [ffa8200]
  - every-plugin@2.5.9

## 1.13.1

### Patch Changes

- 4c72604: Switch npm publishing from NPM_TOKEN to OIDC trusted publishing

  - Add `id-token: write` permission for OIDC token generation
  - Remove `NODE_AUTH_TOKEN` / `NPM_TOKEN` from publish steps — npm CLI ≥11.5.1 auto-detects OIDC
  - Fix `cli.js` shebang from `#!/usr/bin/env bun` to `#!/usr/bin/env node` so npm accepts the bin entry (npm auto-corrected/removed bin entries with non-node shebangs)

  One-time manual step required: configure trusted publisher on npmjs.com for both `every-plugin` and `everything-dev` (Settings → Trusted Publisher → GitHub Actions → NEARBuilders/everything-dev → release.yml).

## 1.13.0

### Minor Changes

- ca92870: Harden template workflows and eliminate Renovate config drift

  Template CI and release-sync workflows now match the security posture of live workflows: SHA-pinned GitHub Actions, `--ignore-scripts` on bun install, `permissions:` at job/top level, dependency review, `bun audit` (fails on critical/high), secrets scoped to step-level `env:`, and `id-token: write` removed.

  `.github/renovate.json` is now a symlink to `.github/templates/renovate.json` — single source of truth, no drift possible.

  `bos upgrade` will clean up `.github/dependabot.yml` and `.github/templates/dependabot.yml` from child projects (added to `OBSOLETE_FILES`).

  `bos sync` now treats `.github/renovate.json` and `.github/workflows/ci.yml` as framework-owned files (always overwritten on sync).

- 0882f5d: Plugin-as-bosconfig architecture with sidebar generation and plugin UI remotes

  **Features:**

  - `extends` field supports object form `{ development?, production?, staging? }` for env-specific parent configs with fallback chain
  - `defu`-based deep merge for extends chains: child overrides parent scalars, shared deps deep-merge, secrets union, null/false sentinel removes inherited plugins
  - Resolved config lifecycle: `bos dev`/`bos build` write to `.bos/bos.resolved-config.json` (gitignored) instead of mutating `bos.config.json`
  - Plugin bos.config.json files are standalone (no `extends`) — define `domain`, `app`, `sidebar`, `routes` independently
  - Root plugin entries use `extends: "bos://..."` to resolve production config from remote registry
  - String shorthand for plugin entries: `"key": "bos://account/domain"` normalizes to `{ extends: "bos://..." }`
  - Sidebar generation from plugin configs with `roleRequired` ("anon"|"member"|"admin") filtering
  - Plugin UI remotes: host loads sub-FederationEntry from `app.ui` in plugin config
  - `bos publish --deploy` publishes both root and plugin bos.config.json to registry
  - `pluginPublish` prefers plugin config `domain` field over extends parsing for registry path
  - `personalizeConfig` creates standalone plugin bos.config.json files (domain + app + sidebar + routes)
  - Plugin UI support: `detectLocalPackages` discovers plugin UI, `prepareDevelopmentRuntimeConfig` assigns ports
  - Canonical key ordering enforced everywhere via shared `rebuildOrderedConfig()`
  - Config validation in shared sync via `BosConfigSchema.parse`
  - Staging env support in `RuntimeConfig` and `ClientRuntimeConfig` schemas

  **Refactors:**

  - Renamed `registry` → `apps`, `_template` → `settings`
  - Organizations moved to auth sidebar
  - `resolveRuntimePlugins` no longer recursively resolves nested plugins from extends chains
  - Plugin rspack configs: removed `updateRootConfig` (plugins never update root), generalized `updateLocalConfig` to `updateLocalConfigSection` for any `app.{section}`
  - Release workflows commit `**/bos.config.json` (root + plugins) instead of just root
  - `personalizeConfig` strips `extends` and production URLs from plugin bos.config.json in both init and sync modes
  - Extract `isPathExcluded`, `saveBosConfig`, `generateAuthTypesTemplate()` utilities
  - Replace `(pluginInput as any)` with proper typing, add `getPluginRef()` helper
  - Remove unused `resolveBosConfigInput` helper

  **Tests:** 31 new integration tests (88 total, up from 57)

### Patch Changes

- 6425196: Upgrade hono to >=4.12.18 to resolve 5 security vulnerabilities (CSS injection, JWT validation, cache leakage, XSS, bodyLimit bypass). Soften CI audit step to warn instead of fail on high/critical findings for build-time-only dependencies.
- 519ded7: Security hardening: switch to Renovate, pin actions to SHAs, remove pull_request_target, scope secrets

  - Replace Dependabot with Renovate (minimumReleaseAge 3 days general, 5 days @tanstack/\*, minor bumps never automerged, helpers:pinGitHubActionDigests)
  - Pin all GitHub Actions to commit SHAs to prevent tag-hijacking attacks
  - Remove pull_request_target from preview.yml to prevent Pwn Request cache-poisoning
  - Scope secrets to individual steps (not job-level env), remove id-token:write from job-level permissions
  - Add dependency-review-action to CI for PRs
  - Make bun audit fail on critical/high findings
  - Document shared singleton trust model and supply chain incident response

## 1.12.4

### Patch Changes

- 6f693df: Consolidate `buildRuntimeConfig` into single canonical implementation in config.ts

  The `repository` field from `bos.config.json` was missing from the browser runtime config because `app.ts` had a duplicate `buildRuntimeConfig` that omitted it. This consolidates the two implementations into one, eliminating field drift risk. Also fixes integrity/ssrUrl to be source-based rather than only env-based.

## 1.12.3

### Patch Changes

- b5e684b: Preserve catalog references in scaffolded projects so framework versions update from a single root catalog entry.
- 21836cb: Remove legacy UI generator plumbing and tighten the scaffold surface so fresh projects and upgrades do not ship references to missing files.

## 1.12.2

### Patch Changes

- 482cca9: Expand shared UI auth dependency policy so downstream apps inherit singleton better-auth, better-near-auth, and Better Auth client addons through template sync. Declare the UI's direct Better Auth addon dependencies explicitly to avoid duplicate installs and nominal type mismatches.

## 1.12.1

### Patch Changes

- 9b69858: Expand the shared auth dependency policy so downstream apps inherit singleton `better-auth`, `better-near-auth`, and Better Auth client addons through template sync. Also declare the UI's direct Better Auth addon dependencies explicitly to avoid duplicate installs and nominal type mismatches.

## 1.12.0

### Minor Changes

- cd7692f: Strengthen the generated auth surface and remove duplicate client facades so downstream packages rely on the canonical typed auth client.

### Patch Changes

- Updated dependencies [cd7692f]
  - every-plugin@2.5.8

## 1.11.5

### Patch Changes

- e2b4b85: Remove host/api/ui/plugins source from Docker image (loaded remotely at runtime). Remove deprecated `GATEWAY_DOMAIN` environment variable in favor of consistent `BOS_GATEWAY`.

## 1.11.4

### Patch Changes

- 6189953: Compile CLI to standalone binary in Dockerfile for faster cold starts. Remove deprecated `GATEWAY_DOMAIN` environment variable in favor of consistent `BOS_GATEWAY`.
- Updated dependencies [b193ad6]
  - every-plugin@2.5.7

## 1.11.3

### Patch Changes

- d920486: Export `Auth` type from generated auth-types.gen.ts for inferAdditionalFields

  The `auth-types.gen.ts` file now re-exports `Auth` from better-auth so
  the UI can use `inferAdditionalFields<Auth>()` instead of
  `inferAdditionalFields<typeof createAuthInstance>()`.

- b77bb9e: Fix auth-types.gen.ts fallback when auth plugin is remote or missing locally

  Previously `auth-types.gen.ts` always fell back to `plugins/auth/src/auth-export.ts` regardless of whether that file existed, causing typecheck errors in projects without a local auth plugin. Now uses a three-tier fallback: (1) local `plugins/auth/src/auth-export.ts` if it exists on disk, (2) cached `.bos/generated/auth/auth-export.d.ts` from a previous remote fetch, (3) `better-auth` stub as final fallback. Once the auth plugin includes `additionalExports` in its manifest, the remote fetch path will also resolve automatically.

- Updated dependencies [13f68ff]
  - every-plugin@2.5.6

## 1.11.2

### Patch Changes

- 60398aa: Fix `bos init` ordering: ensure env, install, types, and migrations run in correct sequence

  - `ensureEnvFile` now runs before `bun install` so secrets are available for postinstall
  - `bun install` uses `--ignore-scripts` to prevent postinstall from disrupting dependency installation (which caused incomplete `node_modules` and rsbuild/rspack "command not found")
  - `bos types gen` runs explicitly after install via `node_modules/.bin/bos`
  - `ensureEnvFile` now populates `CORS_ORIGIN` from the project domain (required by auth plugin)
  - Added `CORS_ORIGIN` to `.env.example`
  - Init "Next steps" now includes `docker compose up -d --wait`
  - Same install/types-gen ordering applied to `bos sync` and `bos upgrade`

## 1.11.1

### Patch Changes

- 473ec2a: Fix `bos init` to always set `postinstall` and `types:gen` scripts in scaffolded projects

  Previously `postinstall` was only set if the source `package.json` already had it, and `types:gen` was never rewritten from the monorepo path. This caused scaffolded projects to have missing or broken type generation, leaving `.gen.ts` stubs empty and breaking `rsbuild`/`rspack` startup when `bun install` failed silently.

  - `postinstall` is now unconditional: `node_modules/.bin/bos types gen || true`
  - `types:gen` script is now always added: `node_modules/.bin/bos types gen`
  - `|| true` prevents a failing type gen from blocking `bun install` completion

## 1.11.0

### Minor Changes

- 231fab5: Add environment variable support to `bos start` for containerized deployments

  The `start` command now reads `BOS_ACCOUNT` and `BOS_GATEWAY` from `process.env` when CLI flags are not provided, enabling config-less Docker containers that fetch runtime configuration directly from the NEAR FastKV registry.

  Also removed `bos.config.json` from the Dockerfile so the image no longer bakes in local configuration.

## 1.10.0

### Minor Changes

- 8a7eca9: Add runtime account and domain overrides to `bos start`

  - `bos start --account <id> --domain <domain>` now attempts to fetch the config from the FastKV registry first
  - If the remote fetch fails, it gracefully falls back to the local `bos.config.json` instead of erroring
  - The `--account` and `--domain` values are applied as overrides to whichever config is used (remote or local)
  - The `start` npm script passes through `BOS_ACCOUNT` and `GATEWAY_DOMAIN` environment variables as CLI flags
  - Added `packages/everything-dev/tests` to `.dockerignore`

## 1.9.9

### Patch Changes

- 99660fa: Fix FastDATA KV publish for mainnet accounts and eliminate false txHash extraction.

  **Namespace mismatch:** `getRegistryNamespaceForAccount` previously defaulted to the publishing account itself on mainnet (e.g., `auth.everything.near`), while the registry plugin expected `dev.everything.near`. This caused `bos publish` to write data to `dev.everything.near` but verify from the account's own namespace, resulting in missing apps.

  **False txHash:** The fallback regex `/([A-HJ-NP-Za-km-z1-9]{43,44})/` greedily matched receipt IDs, block hashes, or other base58 strings from NEAR CLI error output. This reported fake txHashes and "published" status even when the transaction never reached the network.

  - **fastkv.ts**: Changed mainnet default from `accountId` to `"dev.everything.near"`.
  - **near-cli.ts**: Removed greedy base58 fallback. `softSuccess` (FastDATA `CodeDoesNotExist`) now requires an explicit `Transaction ID:` in NEAR CLI output. Returns `undefined` instead of fake hashes.
  - **plugin.ts**: `extractTransactionHash` no longer matches random base58 strings.
  - **.env.example**: Documented `REGISTRY_FASTKV_*` environment variables.

## 1.9.8

### Patch Changes

- de2c76b: Fix FastDATA KV publish namespace default for mainnet accounts.

  `getRegistryNamespaceForAccount` in `packages/everything-dev/src/fastkv.ts` previously defaulted to the publishing account itself on mainnet (e.g., `auth.everything.near`), while the registry plugin and the publish transaction both used `dev.everything.near`. This mismatch caused `bos publish` to write data to the shared `dev.everything.near` namespace but then verify (and the registry discovery to read) from the account's own namespace, resulting in missing apps for any account other than `dev.everything.near`.

  - **fastkv.ts**: Changed mainnet default from `accountId` to `"dev.everything.near"` so all mainnet accounts publish to the shared registry namespace by default.
  - **.env.example**: Added `REGISTRY_FASTKV_MAINNET_NAMESPACE`, `REGISTRY_FASTKV_TESTNET_NAMESPACE`, `REGISTRY_FASTKV_MAINNET_URL`, and `REGISTRY_FASTKV_TESTNET_URL` to document overrides.

## 1.9.7

### Patch Changes

- Updated dependencies [7e498bb]
  - every-plugin@2.5.5

## 1.9.6

### Patch Changes

- 369c59b: Remove redundant auth plugin variables from `bos.config.json` and inject them at runtime instead.

  - **`host/src/services/plugins.ts`**: Added `baseVariables` parameter to `loadPluginEntry` so runtime-derived values can be merged before explicit `variables` from `bos.config.json`. When loading the auth plugin, the host now injects `account` (from `config.account`) and `domain` (from `config.domain`, defaulting to `"localhost:3000"` in development) as base variables. Explicit values in `bos.config.json` still take precedence if present.

  - **`bos.config.json`**: Removed the `app.auth.variables` block. `account`, `hostUrl`, and `uiUrl` are no longer required here since the host provides `account` and `domain` automatically at plugin initialization time.

- 369c59b: Fix `bos init` failing on fresh projects due to missing database migration files.

  - **`.templatekeep`**: Add `api/src/db/load-migrations.ts`, `api/src/db/migrator.ts`, and `api/src/global.d.ts` to the template allowlist. These source files are imported by `api/src/index.ts` and are required for the API to compile.
  - **`src/cli/init.ts`**: Export `execCommand` and add `generateDatabaseMigrations()`. This function scans the initialized project for any `drizzle.config.ts` (excluding `node_modules`), checks if the workspace has a `db:generate` script, and runs it.
  - **`src/plugin.ts`**: Call `generateDatabaseMigrations()` after `runBunInstall()` during `bos init`. This ensures fresh projects have their Drizzle migrations generated from the schema before the first build, fixing both `MODULE_NOT_FOUND` errors for missing source files and `ENOENT` errors for missing `_journal.json`.

- 369c59b: Fix plugins with `local:` development targets falling back to production URL when the local path is missing.

  - **`src/config.ts` (`resolveRuntimeTarget`)**: When a `local:` path does not exist, return `source: "local"` instead of `source: defaultSource` (which was always `"remote"`). This preserves the semantic intent that the config value is a local reference, allowing `resolveDevelopmentTarget` to detect the missing path and fall back to the production URL.
  - **`src/config.ts` (`buildRuntimePluginConfig`)**: Use `resolveDevelopmentTarget` for the development environment instead of calling `resolveRuntimeTarget` directly. This gives plugins the same production-fallback behavior already used by `app.*` entries (host, ui, api, auth) when a local development path is absent.

- 00df0ce: Fix false-positive outdated package warnings when installed and latest versions are identical.

  - `status.ts`: Fix the regex in `readInstalledVersion` that strips semver prefixes. The negated character class `/^[^^~>=]+/` was accidentally leaving the `^` prefix intact, so `^1.9.5` was never stripped and always compared unequally to `1.9.5`.
  - `cli.ts`: Introduce `normalizeVersion()` helper that strips `^`, `~`, `>=`, and `v` prefixes from both sides before comparing. Applied to `warnIfOutdated`, the `status` command display, and the `status` footer check to prevent all edge-case false positives.

- 2c58902: Remove stale `auth-client.gen.ts` and fix UI implicit-any TypeScript errors.

  - **everything-dev**: Removed `api/src/auth-client.gen.ts` from the `typesGen` generated file list in `plugin.ts`. This file was consolidated into `plugins-client.gen.ts` in a previous release but the metadata still referenced it, causing confusion when the stale file was left in workspaces.

  - **ui**: Added explicit type annotations to callback parameters in:
    - `src/routes/_layout/login.tsx`: `onError` callbacks for NEAR sign-in, passkey, anonymous, email, phone OTP, and GitHub social login.
    - `src/routes/_layout/apps/$accountId/$gatewayId.tsx`: `TransactionBuilder` parameter in two `buildSignedDelegateAction` calls.

  These fixes resolve `noImplicitAny` errors under `strict` mode without changing runtime behavior.

- ddb9952: Extract auth plugin from monorepo and remove `BETTER_AUTH_URL` env dependency.

  - **Deleted `plugins/auth/`**: The auth plugin is now maintained as an external package and loaded at runtime via Module Federation. The `app.auth` entry in `bos.config.json` remains intact for runtime loading.

  - **`host/src/services/plugins.ts`**: Added `normalizeDomain(domain, env)` helper that:

    - Returns as-is if the domain already has `http://` or `https://`
    - Prepends `http://` for `localhost` / `127.0.0.1` in development
    - Prepends `https://` for everything else
    - Applied to `domain` and `hostUrl` base variables when loading the auth plugin.

  - **Removed `BETTER_AUTH_URL`**: Dropped from `.env.example` and `packages/everything-dev/src/plugin.ts` env generation. The auth plugin now derives its base URL from the normalized `hostUrl` variable passed by the host at initialization time.

## 1.9.5

### Patch Changes

- 428f5a0: Fix `init` pinning stale versions and `status` nagging on workspace references.

  - `manifest-normalizer.ts`: Prefer the running CLI's own package version over the downloaded template source when resolving `everything-dev`/`every-plugin` versions during `bos init`. Generated projects now get the version of the CLI that created them (e.g. `^1.9.3` instead of a potentially newer/unavailable `^1.9.4`), preventing `bun install` failures when the template source is ahead of the cached CLI.
  - `status.ts`: Skip `workspace:*`, `catalog:*`, and `file:` specifiers in `readInstalledVersion`. Prevents `bos status` / `warnIfOutdated` from treating local workspace references as outdated packages.

## 1.9.4

### Patch Changes

- b1adcb2: Fix SSR crash: pass runtimeConfig from router context to auth client instead of reading window.**RUNTIME_CONFIG** during server-side route matching

## 1.9.3

### Patch Changes

- f99047b: Fix plugins not loading in production: `bos start` now always resolves plugin URLs for production mode instead of using development-resolved configs with empty URLs

## 1.9.1

### Patch Changes

- fc15802: Fixed CLI log message during `bos init` to use `p.log.info` instead of `console.log`, preventing it from breaking the clack spinner output.

  Prevented stale local `packages/every-plugin` copies in generated projects by ensuring `.templatekeep` excludes `packages/*`.

  Added proactive outdated-package warning in CLI when running `dev`, `build`, or `start` commands. Warns users when `every-plugin` or `everything-dev` are behind the latest npm version and suggests running `bos upgrade`.

## 1.9.0

### Minor Changes

- 333ceda: Add `bos types gen` command for remote-first type generation and consolidate generated type files.

  - New CLI command `bos types gen` for unified type generation from configured API and plugin contracts.
    - Respects `NODE_ENV` (default development, `production` forces remote URLs).
    - `--dry-run` flag previews what would be fetched without writing files.
    - Fetches oRPC contract types and `additionalExports` (e.g. `auth-export.d.ts`) from deployed plugin manifests.
  - `packages/everything-dev/src/api-contract.ts`:
    - Extended `ApiPluginManifest` with `additionalExports` support.
    - Added `fetchAuthAdditionalExports` to pull `auth-export.d.ts` from remote auth plugins.
    - Auth contract types now included in `api/src/plugins-client.gen.ts` (single file), removing the separate `api/src/auth-client.gen.ts` file.
  - `ui/src/lib/auth-client.ts`:
    - Now imports `createAuthInstance` from `../auth-types.gen` instead of the local `plugins/auth/src/auth-export` path.
  - `packages/everything-dev/src/cli/init.ts` (`personalizeConfig`):
    - Sets `postinstall` to `"bos types gen"` instead of deleting it.
    - Creates `ui/src/auth-types.gen.ts` stub alongside other `.gen.ts` stubs.
    - Removed `api/src/auth-client.gen.ts` stub creation (consolidated into `plugins-client.gen.ts`).
  - Gitignore updated: `**/*.gen.ts` and `.bos/generated/` instead of per-directory rules.
  - Added integration test `init.typecheck.test.ts` that scaffolds a project, installs, and verifies typecheck produces zero unexpected errors.

## 1.8.13

### Patch Changes

- 30323b6: Fix typecheck failures in `bos init` output.

  - Keep `sync:api-contract` as a standalone script (remove only from premature `typecheck` / `postinstall` chains).
  - Strip deleted workspace references (`packages/everything-dev`, `host`) from the generated `typecheck` script.
  - Prune missing `"files"` entries in `api/tsconfig.json` after template copy.
  - Remove local `plugins/auth` import and `inferAdditionalFields` usage from copied `ui/src/lib/auth-client.ts`.
  - Generate `api/src/auth-client.gen.ts` and `api/src/plugins-client.gen.ts` stubs so API compiles without local plugin types.
  - Expand `.templatekeep` to include `api/tests/types.d.ts`, `ui/src/routes/_layout/apps/**`, and `ui/src/routes/_layout/_authenticated/organizations/**`.
  - Update `init.structure.test.ts` assertions for newly included route files.

- 03bb4a0: Fix orchestrator crash cascade from MF DTS plugin failures.

  - `everything-dev`: Add `Effect.catchAllDefect` boundary to `dev-session.ts` so an unhandled rejection in one process (e.g., Module Federation DTS `EISDIR`) no longer tears down the entire `Effect.scoped` scope and kills all child processes.
  - `everything-dev`: Add process-level `unhandledRejection` and `uncaughtException` handlers in `orchestrator.ts` to prevent Node.js from aborting the orchestrator on internal plugin errors.
  - `every-plugin`: Add `.catch()` to the plugin dev server async IIFE in `dev-server-middleware.ts` so fatal middleware setup errors are logged instead of becoming unhandled rejections that crash the child process.

  This prevents the scenario where a TYPE-001 error in one plugin's MF DTS plugin would, within 1-2 minutes, cascade via `EISDIR` into killing the UI and all other plugins simultaneously.

- Updated dependencies [03bb4a0]
  - every-plugin@2.5.4

## 1.8.12

### Patch Changes

- ae127c6: Fix dev session process failure race condition and boot-up resilience

  - Prevent double-completion of `readyDeferred` when a process fails by treating `"error"` as a terminal state in both the exit handler and the log-line handler.
  - Make `awaitReady` resilient so a single failed process (e.g. a plugin with a TypeScript build error) no longer aborts the entire boot-up sequence; the host and other services continue starting.

## 1.8.11

### Patch Changes

- 6dff104: Remove artificial startup timeout, fix TCP false-positive, and auth pglite initialization

  - `packages/everything-dev/src/dev-session.ts`: Remove the hardcoded 30-second `awaitReady` timeout so the host genuinely waits until local plugins (auth, api, template) finish rspack compilation and serve their remote entry.
  - `packages/everything-dev/src/orchestrator.ts`: Remove the TCP-port fallback in `spawnDevProcess` readiness probing. A plugin is now only considered "ready" when its HTTP endpoint returns 200, eliminating false positives where rspack opens its listen port before compilation is complete.
  - `plugins/auth/src/db/driver.ts`: Add `mkdirSync(..., { recursive: true })` before initializing `@electric-sql/pglite`, fixing "PGlite failed to initialize properly" errors caused by PGlite's internal non-recursive `mkdirSync`.

## 1.8.10

### Patch Changes

- 2e79fea: Fix init config ordering, parent plugin leakage, auth pglite resolution, and plugin selection

  - `packages/everything-dev/src/cli/init.ts`: Fix `bos.config.json` key ordering so `extends` is always first and trailing group (`app`, `plugins`, `shared`) is last. Prevent parent plugin leakage by writing `"plugins": {}` instead of deleting the key when no plugins are selected.
  - `packages/everything-dev/src/cli/prompts.ts`: Remove `registry` from `AVAILABLE_PLUGINS` since `.templatekeep` only includes `plugins/_template/**`.
  - `plugins/auth/package.json`, `host/package.json`, `package.json`: Move `@electric-sql/pglite` to runtime `dependencies` so the auth plugin can resolve it when loaded remotely via Module Federation.

- 2e79fea: Fix `syncApiContractBridge` to correctly include local plugins in generated contract types. Previously, plugins with `local:` development paths were skipped because the sync script checked `!plugin.url` — but local plugins intentionally have empty URLs. The guard now checks `!plugin.url && !plugin.localPath`, allowing the contract sync to read `src/contract.ts` directly from disk for locally-developed plugins.

## 1.8.9

### Patch Changes

- fea84e1: Fix `bos upgrade` destroying local `bos.config.json` and crashing on missing plugin directories

  - Guard `syncApiContractBridge` against empty plugin URLs when local directories are missing and no production URL is configured, preventing `fetch() URL is invalid` crashes
  - Make `syncTemplate` merge `bos.config.json` instead of overwriting, preserving local key order and values
  - New template keys are inserted before the canonical trailing group (`app`, `plugins`, `shared`) with `shared` always last
  - `extends` is always preserved as the first key
  - `personalizeConfig` now respects `mode: "sync"` to avoid stripping `production`, `integrity`, `ssr`, and `ssrIntegrity` during upgrades

## 1.8.8

### Patch Changes

- 543c595: Buffer startup and streaming view headers into single console.log writes.

  Replaces scattered `console.log()` calls in `bos start` summary and
  `renderStreamingView` header/ready block with single buffered strings.
  Prevents stdout interleaving when multiple streams write concurrently
  in non-interactive / Docker / CI environments.

## 1.8.7

### Patch Changes

- ac564ad: Fix `resolveWorkspaceTarget` to respect `development` path for app entries.

  Previously, app entries (host, ui, api, auth) were hardcoded to `${configDir}/${key}`, ignoring the `development` field in `bos.config.json`. This caused the auth plugin to be skipped during deploy because it lives at `plugins/auth/` rather than the workspace root.

  Now, if an app entry has a `development` field (e.g., `"local:plugins/auth"`), the path is resolved correctly before falling back to the hardcoded root path.

- ac564ad: Improve `bos start` non-interactive logging and startup summary.

  - Add a clear startup summary showing Config Source (with clickable FastKV URL when loading from registry), Account, Domain, and loaded Modules (HOST, UI, API, AUTH).
  - Consolidate warnings (missing secrets, CORS_ORIGIN defaulting) into the summary instead of scattered log lines.
  - Expand `LOG_NOISE_PATTERNS` to suppress host-internal chatter: Module Federation loading, `[IntegrityMonitor]`, `[Plugins]` internals, separator dumps, and empty `{}` lines.
  - Skip whitespace-only lines in `renderStreamingView` to prevent blank log output.

## 1.8.6

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

- Updated dependencies [a0c5784]
  - every-plugin@2.5.3

## 1.8.5

### Patch Changes

- Updated dependencies [a38288d]
  - every-plugin@2.5.2

## 1.8.4

### Patch Changes

- 5a31eff: Remove noisy `[SRI] Integrity verified for ...` console.log from `verifySriForUrl`.

  The success log fired on every integrity check (plugin loads, SSR boot, and periodic production monitor), producing excessive output. Failures still throw descriptive errors. Silent success, loud failure.

- Updated dependencies [f185a6c]
  - every-plugin@2.5.1

## 1.8.3

### Patch Changes

- edb7258: Fix `resolveContractSource` localPath truthiness bug caused by Zod optional keys.

  Zod includes optional keys as `undefined` on parsed objects, which made the `localPath` truthiness checks in `resolveContractSource` evaluate to `false` even when the key was present. This caused the contract-source resolver to skip local fallbacks for `api` and `auth` keys and incorrectly fall through to `remoteContractSource` with an empty base URL, producing `fetch() URL is invalid` during postinstall.

  Changed the gate conditions for `api` and `auth` keys to always enter their local-handling blocks, and switched the inner/localPath checks from truthiness to explicit `!= null` plus empty-string guards.

- 516376e: Make Module Federation shared dependencies config-driven and fix Docker production runtime crash.

  **Problem:** `every-plugin` hardcoded `drizzle-orm` and `better-auth` as shared MF deps, but these are app-specific packages. In Docker's isolated linker mode, `import("drizzle-orm")` from `every-plugin` failed because the generic framework package does not declare them as dependencies.

  **Solution:**

  - **Core shared deps** (`every-plugin`, `effect`, `zod`, `@orpc/contract`, `@orpc/server`) remain hardcoded in `every-plugin` — these are what the framework itself needs.
  - **App-specific shared deps** moved to `bos.config.json` under `shared.plugins` (same shape as existing `shared.ui`).
  - `ModuleFederationService` now accepts runtime `appShared` config via Effect Context (`AppSharedDepsTag`) and dynamically imports configured packages with `import(name)`.
  - `PluginRuntimeConfig` gains optional `shared` field; `PluginService.Live` threads it through the layer chain.
  - `RuntimeConfigSchema` validates `shared.plugins` alongside `shared.ui`.

  **Build-time cleanup:**

  - Removed `better-auth`/`drizzle-orm` from `pluginSharedDependencies` in `packages/every-plugin/src/build/shared-deps.ts`.
  - Host `rsbuild.config.ts` now merges `bosConfig.shared.plugins` into build-time shared deps.

  **Production startup hardening:**

  - Added preflight validation in `bos start`: checks `shared.plugins` packages are resolvable, validates required secrets from auth/api/plugin configs, warns on missing values.
  - `CORS_ORIGIN` defaults to `https://<config.domain>` when unset in production.
  - Fixed empty error messages in plugin loading by adding `formatError()` helper that properly extracts Effect Cause chains.
  - Removed duplicate secret warnings from `secretsFromEnv` — consolidated in pre-startup validation.

  **Files changed:**

  - `packages/every-plugin/src/runtime/mf-config.ts`
  - `packages/every-plugin/src/runtime/services/module-federation.service.ts`
  - `packages/every-plugin/src/runtime/services/plugin.service.ts`
  - `packages/every-plugin/src/runtime/index.ts`
  - `packages/every-plugin/src/types.ts`
  - `packages/every-plugin/src/build/shared-deps.ts`
  - `packages/everything-dev/src/types.ts`
  - `packages/everything-dev/src/plugin.ts`
  - `host/src/services/plugins.ts`
  - `host/rsbuild.config.ts`
  - `bos.config.json`

- Updated dependencies [516376e]
  - every-plugin@2.5.0

## 1.8.2

### Patch Changes

- Updated dependencies [b20445f]
  - every-plugin@2.4.3

## 1.8.1

### Patch Changes

- Updated dependencies [fac9cf6]
  - every-plugin@2.4.2

## 1.8.0

### Minor Changes

- e53af6e: Add CSP with feature flag, integrity registry, on-chain attestation, and safe plugin client factory

  CSP: Add `CSP_STRICT` const (default false) that toggles between relaxed mode (`'unsafe-inline'` + `'unsafe-eval'`) and strict mode (nonce + `'strict-dynamic'`). Relaxed mode is the default because Module Federation requires `'unsafe-eval'`, making strict inline script enforcement moot. All other CSP directives (object-src, base-uri, frame-ancestors, connect-src, etc.) remain enforced regardless of mode. When strict mode is enabled, nonces are injected into HTML script tags and the runtime config.

  Integrity: Add `IntegrityRegistry` class for SRI hash tracking, `installIntegrityFetchHook` for MF lifecycle fetch interception, `verifyConfigAgainstChain` for on-chain attestation checks, and `startIntegrityMonitor` for periodic background re-verification.

  Safety: Wrap plugin client factories with `createSafeClientFactory` to prevent arbitrary context injection. Merge CSP headers into SSR responses.

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds
- 34207e4: Reorganize dev port assignments: host=3000, api=3001, auth=3002, ui=3003, ui-ssr=3004, plugins=3010+

  Fix dev TUI display: host always shows "running" with port, remote non-host services show "loaded" without port. Strip ANSI codes from log files, only tag stderr as [ERR] when content is actually error-like, and replace Effect.logInfo with console.log in host logger for clean output.

### Patch Changes

- Updated dependencies [0a67206]
  - every-plugin@2.4.1

## 1.7.2

### Patch Changes

- 3ce93d9: `bos upgrade` now bumps `every-plugin` and `everything-dev` in **all workspace `package.json`s**, not just the root. It also updates `peerDependencies` and `workspaces.catalog` while correctly skipping `workspace:*` and `catalog:` references.

## 1.7.1

### Patch Changes

- 1744ec3: Remove duplicate `zod` from `dependencies` (already in `peerDependencies`). Add `@tanstack/router-plugin>zod` override to root `package.json` so the TanStack Router plugin resolves `zod` v3 instead of the hoisted v4 during build.

## 1.7.0

### Minor Changes

- ab0a308: Move auth from plugin to app-level infrastructure with oRPC contract generation

  Auth is now `app.auth` in bos.config.json instead of `plugins.auth`. The host loads the auth plugin as Phase 0 (app-level infrastructure) before other plugins. Session resolution and auth HTTP handler are provided through the auth plugin's oRPC client and initialized context, eliminating direct Better Auth coupling in the host. The `syncApiContractBridge` now generates typed auth contract clients in `api/src/plugins-client.gen.ts` and `ui/src/api-contract.gen.ts`, enabling plugins to call auth routes via `services.plugins.auth()` instead of importing the raw `Auth` type.

- 368c872: Improve plugin lifecycle cleanup, add additionalExports, and share BosConfigInput

  Plugin shutdown now logs warnings instead of silently swallowing errors. DB layers use Effect acquireRelease for proper connection cleanup. Build system supports additionalExports for bundling extra type files. BosConfigInput is now exported from everything-dev/types for shared use. Registry plugin validates private key format before creating relay clients.

- c0452e7: Renamed `productionIntegrity` to `integrity` across all schemas, build configs, and `bos.config.json`. Added `name` and `version` fields to `BosPluginRef`. Enhanced `bos plugin add` with `bos://account/plugins/name` registry resolution, manifest validation, and automatic integrity computation. Enhanced `bos plugin publish` with manifest validation, integrity computation, and FastKV plugin registry writes. Added generic KV routes (`kvGet`, `kvList`, `kvPrepareWrite`, `kvRelayWrite`) to the registry plugin.

### Patch Changes

- 069cb6a: Upgrade better-near-auth from local file import to published v1.0.0

  Switches the workspace catalog entry from `file:../../lib/better-near-auth` to `^1.0.0`, consuming the official npm release. The v1.0.0 package already includes the near-kit + @hot-labs/near-connect migration and the relay API shape used by the gateway page, so no source code changes are required.

  - `relayer: {}` in server config continues to use all defaults (ephemeral auto-generated keypair)
  - Client `siwnClient({ recipient, networkId })` remains valid
  - `auth.near.buildSignedDelegateAction()` and `auth.near.relayTransaction({ payload })` APIs unchanged

- c038761: Move consumer workflow templates from `.templates/` to `.github/templates/` and update prefix logic so `.github/templates/` is replaced with `.github/` on copy
- Updated dependencies [368c872]
  - every-plugin@2.4.0

## 1.6.0

### Minor Changes

- d96b5d3: Enforce effect and zod as singleton shared dependencies across Module Federation runtime

  - Add `effect` and `zod` as direct dependencies in api, host, and ui packages with catalog-pinned exact versions
  - Move `every-plugin` from devDependencies to dependencies in api and ui (runtime import)
  - Add `effect` and `zod` to `bos.config.json` `shared.ui` as singleton MF shared deps to prevent duplicate runtime instances
  - Pin `effect`, `zod`, and `@orpc/*` to exact versions in workspace catalog and add overrides to eliminate version drift
  - Unify `@orpc/*` version refs across api, host, and ui to use catalog instead of mixed ranges
  - Update `every-plugin` mf-config to resolve effect/zod versions from installed packages instead of hardcoded ranges
  - Merge `overrides` field in sync flow's `mergePackageJson` to preserve user overrides during upgrade

### Patch Changes

- Updated dependencies [d96b5d3]
  - every-plugin@2.3.0

## 1.5.0

### Minor Changes

- 8582862: Add plugin-owned routes via `routes` field in `bos.config.json`, protect user-owned files on upgrade, resolve `catalog:` refs

  **Plugin routes:**

  - Each plugin in `bos.config.json` can declare a `routes` array (e.g. `"routes": ["ui/src/routes/_layout/apps/**"]`)
  - During init, only routes for selected plugins are copied
  - During sync, routes are dynamically included/excluded based on the child project's plugin config
  - Removed plugin-owned routes from `.templatekeep` — they're now managed via `routes`

  **Upgrade protection (`.templatesync-exclude`):**

  - `ui/src/components/**` and `ui/src/styles.css` — never overwritten
  - `ui/src/routes` — managed dynamically via plugin `routes`; removed blanket `ui/src/routes/**` exclude so enabled plugin routes can sync
  - `api/src/contract.ts`, `api/src/index.ts`, `api/src/db/schema.ts` — core business logic protected
  - `api/drizzle.config.ts`, `api/tsconfig.*` — project-specific config protected
  - `api/package.json`, `api/plugin.dev.ts`, `api/rspack.config.js` now syncable on upgrade (with package.json merge)

  **`catalog:` resolution:**

  - `resolveCatalogRefs: true` during init — `catalog:` version refs are resolved to actual versions so consumer projects don't need a workspace catalog

- 8582862: Redesign `bos init` flow and improve `bos sync`/`bos upgrade` safety

  **Init prompt redesign:**

  - Domain is now the first prompt
  - Single "Extend from" field accepts `account/gateway` format (e.g. `dev.everything.near/everything.dev`) instead of separate prompts
  - Plugin selection prompt with toggle-by-number UI; only `_template` is selected by default, `registry` is opt-in
  - Directory defaults to full domain name (e.g. `sample.com`)
  - Output shows relative directory path instead of absolute

  **Plugin handling:**

  - Only selected plugins are copied, configured in `bos.config.json`, and included in workspaces
  - `bos sync` filters plugin files based on the child project's `bos.config.json` plugins list
  - `plugins/registry/**` removed from `.templatekeep`; `plugins/_template/**` is the only plugin carried by default

  **Sync/upgrade safety:**

  - `.templatesync-exclude` now protects all API config files: `drizzle.config.ts`, `package.json`, `plugin.dev.ts`, `rspack.config.js`, `tsconfig.json`, `tsconfig.contract.json`
  - `.github/workflows/**` added to `.templatekeep` so CI workflows carry forward
  - `.gitignore` added to `.templatekeep`

### Patch Changes

- 8582862: Allow `api/package.json`, `api/plugin.dev.ts`, and `api/rspack.config.js` to sync on upgrade with package.json merge logic that preserves project-specific deps and scripts; protect `ui/src/components/**` and all `api/src/**` from sync overwrite
- 8445bc2: Fix `bos init` output: default directory to full domain name instead of first segment, and show relative path instead of absolute
- 8582862: Add helpful merge guidance to upgrade and sync output, use `.github/templates/` directory for consumer workflows

  **Upgrade/sync output:**

  - "Upgrade successful" with categorized guidance: never overwritten (safe), replaced (review), merged (deps preserved), skipped (already yours)
  - Sync output includes similar review prompt when files are updated

  **Consumer workflow templates (`.github/templates/`):**

  - `release-sync.yml` — build, deploy, publish, Docker (no monorepo-specific steps)
  - `ci.yml` — lint, typecheck, Docker build
  - `dependabot.yml` — dependency updates
  - `.github/templates/` prefix replaced with `.github/` on copy so files land at correct paths

  **Sync exclude refinements:**

  - Removed `AGENTS.md`, `api/drizzle.config.ts`, `api/tsconfig.*` from exclude — these are replaced/merged on upgrade
  - Only core business logic remains protected: `api/src/contract.ts`, `api/src/index.ts`, `api/src/db/schema.ts`

- 8582862: Add consumer-friendly workflow templates (`.github/templates/`), remove AGENTS.md and API config from sync exclude, add `routes` to plugin schema

  **Workflow templates:**

  - `.github/templates/workflows/release-sync.yml` — consumer build/deploy/publish pipeline (no monorepo-specific steps)
  - `.github/templates/workflows/ci.yml` — consumer lint/typecheck/docker workflow
  - `.github/templates/dependabot.yml` — consumer dependency updates
  - `.github/templates/` prefix is replaced with `.github/` on copy so files land at correct paths

  **Sync exclude changes:**

  - Removed `AGENTS.md` — synced on upgrade, user can merge or revert
  - Removed `api/drizzle.config.ts`, `api/tsconfig.json`, `api/tsconfig.contract.json` — replaced/merged on upgrade
  - Only `api/src/contract.ts`, `api/src/index.ts`, `api/src/db/schema.ts` remain protected (core business logic)

  **Schema:**

  - Added `routes` field to `BosPluginRefSchema` — each plugin can declare route patterns it owns

## 1.4.1

### Patch Changes

- ab66f0d: Add `@libsql/client` to root dependencies so `bos init` carries it forward to consumer projects, fixing Module Federation resolution error when loading remote host

## 1.4.0

### Minor Changes

- fd85af1: Add `bos sync`, `bos upgrade`, and `bos status` commands; redesign `bos init` prompts

  **New commands:**

  - `bos sync` — Sync template files from parent project with hash-based change detection, file backup, and local exclusion support
  - `bos upgrade` — Upgrade `everything-dev` and `every-plugin` packages from npm, then auto-sync template files
  - `bos status` — Show project health: extends ref, package versions, update availability, last sync time, .env status, parent reachability

  **Breaking changes to `bos init`:**

  - `account` → `extendsAccount` (parent NEAR account)
  - `gateway` → `extendsGateway` (parent gateway)
  - `name` → `account` (new project's NEAR account)
  - `destination` → `directory` (target directory)
  - Prompt order changed: domain first, then account/directory auto-derived from domain, extends shown last
  - Validates extends reference on-chain before downloading tarball
  - Writes `.bos/sync-snapshot.json` for future sync baseline

  **Other improvements:**

  - `.templatesync-exclude` defines user-owned files (routes, api contract, db schema) that sync never overwrites
  - `.bos/sync-local-exclude` lets projects add their own sync exclusions
  - Sync backs up files to `.bos/sync-backup/` before overwriting
  - `.bos/sync-snapshot.json` unignored from `.gitignore` for team sharing
  - Init next steps now show `cp .env.example .env` and `bun run dev`

### Patch Changes

- fd85af1: Fix first publish failure: wrap FastKV verification in try/catch so a valid txHash is accepted as proof of success when config doesn't exist yet on-chain

## 1.3.7

### Patch Changes

- 71bbd2d: Fix init template: add missing `postcss.config.mjs`, `ui/src/assets/**`, integrations, and `_authenticated` route children; remove phantom entries; add `api-contract.gen.ts` stub generation; strip `development` exports from published every-plugin; align `zod` dependency to `^4.3.6` to match every-plugin shared scope

## 1.3.6

### Patch Changes

- 466664d: Fix init template: add missing `postcss.config.mjs`, `ui/src/assets/**`, integrations, and `_authenticated` route children; remove phantom entries; add `api-contract.gen.ts` stub generation; strip `development` exports from published every-plugin
- Updated dependencies [466664d]
  - every-plugin@2.2.6

## 1.3.5

### Patch Changes

- f276764: Fix Docker image to install framework packages from npm instead of local symlinks
- Updated dependencies [f276764]
  - every-plugin@2.2.5

## 1.3.4

### Patch Changes

- Updated dependencies [ce2c9fe]
  - every-plugin@2.2.4

## 1.3.3

### Patch Changes

- 2b86efd: Fix npm manifests — resolve workspace/catalog refs for published packages
- Updated dependencies [2b86efd]
  - every-plugin@2.2.3

## 1.3.2

### Patch Changes

- 1859d7f: Fix npm trusted publishing provenance verification by aligning package repository metadata with the GitHub repository URL.
- Updated dependencies [1859d7f]
  - every-plugin@2.2.2

## 1.3.1

### Patch Changes

- Updated dependencies [01aec75]
  - every-plugin@2.2.1

## 1.3.0

### Minor Changes

- 5edf2fa: Rewrite package exports to dual conditional format (`development` → source, default → dist). Add `buildEverythingDevQuietly()` to CLI to ensure dist is built before workspace builds. Add missing tsdown entries for `every-plugin/orpc/client` and `every-plugin/orpc/openapi`. Add `prepublishOnly` and `customConditions: ["development"]` to all consumer tsconfigs. Move re-exported `@orpc/*` packages to `peerDependencies` in `every-plugin`.
- b666191: Restructure Docker build and release pipeline

  - **Multi-stage Docker build** excludes `packages/` from the final image. The builder stage resolves `workspace:*` refs to npm versions (via `scripts/resolve-workspace-refs.ts`), installs from npm, then the final stage copies only app code + node_modules.
  - **Release pipeline** is now a single sequential job: npm publish gates Zephyr deploy and Docker build. If npm publish fails, nothing else runs.
  - **Start command** uses `bos start` (binary from npm) instead of `bun packages/everything-dev/cli.js`. Account and domain are read from `bos.config.json`.
  - **`everything-dev` and `every-plugin`** moved to `dependencies` in root `package.json` (runtime deps in Docker).
  - **`docker.yml`** is now `workflow_dispatch` only — the release workflow builds Docker inline.

### Patch Changes

- Updated dependencies [5edf2fa]
  - every-plugin@2.2.0

## 1.2.0

### Minor Changes

- cffb977: Add `bos init` command for scaffolding new projects from any bos-configured repo template
- d4df05d: ## Infrastructure: CI optimization, Docker hardening, staging environments, config-driven architecture

  ### CI/CD improvements

  - **Consolidated lint + typecheck** into a single job (was 2 sequential), removing ~1-2 minutes per CI run
  - **Replaced `bun lint` + `bun format:check`** with single `biome ci .` command
  - **Pinned Bun version** to `"1.4"` in all workflows (was `latest`)
  - **Added native caching** via `setup-bun@v2` cache option (removed redundant `actions/cache`)
  - **Upgraded `actions/checkout`** from v6 to v4
  - **Parallelized typecheck** across packages using background processes (`& wait`)
  - **Staging deployment workflow** (`.github/workflows/staging.yml`) — builds `:staging` image on merge to main
  - **Preview deployment workflow** (`.github/workflows/preview.yml`) — builds `:pr-N` image per PR, comments preview URL
  - **CI workflows read domain from `bos.config.json`** via `jq` instead of hardcoding

  ### Docker hardening

  - **Non-root user**: Container now runs as `appuser` (UID 1001) instead of root
  - **Layer caching**: Dependencies installed before source code copy for better cache hits
  - **Bun 1.4**: Updated base image from `oven/bun:1.3.9-alpine` to `oven/bun:1.4-alpine`
  - **Added `curl` and `/health` healthcheck** with 30s interval
  - **Removed `Dockerfile.dev`**: Development flow uses `bos dev`, not a dev Docker image
  - **Added `railway.json`** for Railway deployment configuration with health checks

  ### Staging environment support

  - **Added `staging` field** to `BosConfigSchema` for staging domain configuration
  - **Added `--env` flag** to CLI start command supporting `production` and `staging` environments
  - **Updated `start` script** to accept `APP_ENV` environment variable for environment selection
  - **Staging mode** sets `GATEWAY_DOMAIN` from `config.staging.domain` and labels process as "Staging Mode"

  ### Config-driven architecture

  `bos.config.json` is now the single source of truth. All hardcoded values have been eliminated in favor of deriving from config at runtime or build time:

  - **Removed hardcoded defaults** from `package.json` start script — `--account` and `--domain` no longer have shell fallbacks; config is read from `bos.config.json`
  - **`BETTER_AUTH_URL`** now defaults to `config.hostUrl` instead of hardcoded `localhost:3000`
  - **`fastkv.ts`** mainnet fallback uses the actual `accountId` parameter instead of hardcoded `"dev.everything.near"`
  - **Host page title** uses `config.domain` instead of hardcoded `"everything.dev"`
  - **UI app name** is injected at build time from `bos.config.json` via rsbuild `source.define` (was hardcoded `"everything.dev"` in 15+ route files)
  - **UI `about.tsx`** registry query params use `activeRuntime.accountId`/`gatewayId` instead of hardcoded values

  ### Breaking changes

  - `BOS_ACCOUNT` and `GATEWAY_DOMAIN` are no longer default-encoded in Docker image — config comes from `bos.config.json`
  - Docker `CMD` no longer passes `--account` / `--domain` — use `APP_ENV` env var to switch environments
  - `BosConfigSchema` now includes optional `staging` field — existing configs are unaffected
  - `StartOptionsSchema` now includes optional `env` field — existing invocations are unaffected
  - UI `branding.ts` `APP_NAME` now reads from `import.meta.env.APP_NAME` with `"everything.dev"` fallback

- d1a56cb: ## API pluginsClient: in-process plugin composition

  The API plugin receives a `pluginsClient` map of typed client factories via `createPlugin.withPlugins<PluginsClient>()`, enabling in-process calls to other plugin routers without HTTP roundtrips.

  - **New**: `createPlugin.withPlugins<P>()` on `every-plugin` — pre-binds the plugins type generic, eliminating the `plugins: null as unknown as P` hack
  - **New**: Generated types now live alongside their consumers — `api/src/plugins-client.gen.ts` and `ui/src/api-contract.gen.ts` instead of `.bos/generated/`
  - **New endpoint**: `GET /api/demo/plugins` — demonstrates variable flow from `bos.config.json` and in-process plugin client usage
  - **Config-driven**: API variables (`app.api.variables`) and plugin variables (`plugins.{key}.variables`) configured in `bos.config.json`
  - **Generic host**: No plugin-specific code in the host — it loads plugins from config and injects client factories

  ### Usage

  ```typescript
  import type { PluginsClient } from "./plugins-client.gen";

  export default createPlugin.withPlugins<PluginsClient>()({
    initialize: (config, plugins) =>
      Effect.sync(() => ({
        plugins,
        demoMessage: config.variables.demoMessage,
      })),
    createRouter: (services, builder) => ({
      pluginDemo: builder.pluginDemo.handler(async () => {
        const status = await services.plugins.registry().getRegistryStatus();
        return {
          apiVariable: services.demoMessage,
          registryStatus: status,
          availablePlugins: Object.keys(services.plugins),
        };
      }),
    }),
  });
  ```

- 7e1286a: ## Security hardening: SRI integrity, CORS tightening, and config cleanup

  ### Subresource Integrity (SRI) for remote entries

  - **New `everything-dev/integrity` module** with `computeSriHash`, `computeSriHashForUrl`, and `verifySriForUrl` — single source of truth for all integrity operations
  - **Deploy hooks** now compute SHA-384 hashes of `remoteEntry.js` and write `productionIntegrity`/`ssrIntegrity` to `bos.config.json` on deploy
  - **Client-side SRI**: `<script>` tags for remote entries now include `integrity` and `crossorigin="anonymous"` attributes
  - **Server-side SRI verification** before loading SSR modules, API plugins, and UI federation remotes
  - **Integrity plumbing**: `productionIntegrity` and `ssrIntegrity` fields flow through `BosConfig` → `RuntimeConfig` → `ClientRuntimeConfig` → HTML rendering

  ### CORS hardening

  - **`host/src/services/auth.ts`**: Better Auth `trustedOrigins` now falls back to `[hostUrl, ...uiUrl]` instead of `[]` when `CORS_ORIGIN` is unset, aligning with Hono CORS middleware
  - **`host/src/program.ts`**: Production warning when `CORS_ORIGIN` is unset; fixed bug where empty `uiConfig.url` could be included as a CORS origin
  - **`packages/everything-dev/src/host.ts`**: CORS origins now include UI URL in fallback; production warning added
  - **Production warning** added for missing `BETTER_AUTH_SECRET`

  ### Config / type cleanup

  - **Removed `resolvedConfig` and `canonicalConfigUrl`** from `ClientRuntimeInfo` — these leaked arbitrary config data to the client
  - **Renamed `ActiveRuntimeInfo`** to `ClientRuntimeInfo` everywhere for consistency
  - **Deduplicated `SharedDepConfigSchema`** — now an alias for `SharedConfigSchema`
  - **Added `productionIntegrity`** to `BosConfigInput` interface, removing `as any` cast
  - **Added `testnet`** to `BosConfigSchema`

  ### Bug fixes

  - Fixed trailing slash inconsistency in host's SSR URL construction
  - Fixed SRI integrity check being inside Effect retry scope (now fails fast, only module loading is retried)
  - Added `integrity` verification to API plugin loading (`everything-dev/src/api.ts` and `host/src/services/plugins.ts`)

  ### Breaking changes

  - `ActiveRuntimeInfo` type removed — use `ClientRuntimeInfo`
  - `resolvedConfig` and `canonicalConfigUrl` removed from `ClientRuntimeInfo`
  - `BetterAuth` `trustedOrigins` default changed from `[]` to `[hostUrl, ...uiUrl]`

### Patch Changes

- 96a492e: Fix bos init: add interactive prompts, fix --with-host, separate noInstall/noInteractive

  - `account` and `gateway` are now optional — running `bos init` without them shows interactive prompts defaulting to `dev.everything.near` / `everything.dev`
  - `--with-host` now correctly copies host files (was broken: `.templatekeep` doesn't include `host/**`)
  - `--no-install` no longer implied by `--no-interactive` — they are independent controls
  - `name` and `domain` fall back to `account` / `gateway` when not provided, so generated `bos.config.json` is personalized instead of retaining parent values
  - Prompts for project directory name (defaults to gateway)

- Updated dependencies [8e378e3]
- Updated dependencies [d1a56cb]
  - every-plugin@2.1.0

## 1.1.0

### Minor Changes

- 5524246: Refactor CLI and plugin orchestration: remove standalone `packages/cli`, absorb its responsibilities into `everything-dev`, restructure the BOS plugin and contract generation pipeline, overhaul the API registry, and update the plugin build system with a new rspack config format and data-URI fix.

### Patch Changes

- Updated dependencies [5524246]
  - every-plugin@2.0.0

## 1.0.3

### Patch Changes

- 1cea1e1: Fix mixed content errors when behind reverse proxy (Railway, etc.)

  Added support for `X-Forwarded-Proto` and `X-Forwarded-Host` headers to correctly determine the request URL when the server is behind a reverse proxy. This fixes mixed content errors where HTTPS pages were making HTTP API requests.

  Also added `secureHeaders` middleware for additional security headers (X-Content-Type-Options, X-Frame-Options, etc.).

## 1.0.2

### Patch Changes

- 53ac5f1: Fix CLI shutdown and streamed process output so terminal formatting stays intact during interactive runs and progress updates.

## 1.0.1

### Patch Changes

- 20cb357: Add a local `bos key publish` command for creating a restricted publish key and make publish fall back to local keychain signing when no plaintext key is provided.

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0

### Minor Changes

- 9cb973d: Abstract UI runtime into everything-dev package

  - Moved router creation, SSR rendering, and hydration into everything-dev/ui
  - Split package exports into ./ui/client (browser-safe) and ./ui/server (SSR)
  - Added networkId derivation from account suffix (testnet/mainnet)
  - Created canonical ui/src/app.ts barrel for apiClient, authClient, runtime helpers
  - Deleted ui/src/remote/\* indirection layer
  - Added API contract manifest with checksum for type sync
  - Added everything-dev types sync CLI command

### Patch Changes

- 44393e7: Fix published app discovery and FastKV publish flow so registry reads use the stored manifest data, publish can succeed after FastKV indexing, and the app explorer links directly to the FastKV config record.
- 44393e7: Add plugin support with improved module federation service, shared dependencies handling, and auth client integration
- 44393e7: Refresh the splash-based social metadata and brand assets so the UI ships a stable preview image and matching black-dot favicon set.
- 44393e7: Add under construction page with NEAR CLI integration for session management and development tooling
- Updated dependencies [44393e7]
- Updated dependencies [f080b87]
  - every-plugin@1.0.0
