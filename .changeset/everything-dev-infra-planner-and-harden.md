---
"everything-dev": minor
---

## Infra planner, preflight, and unified allocation

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

---

No breaking changes to published `exports` map. All new types and functions are internal to the package. `link:` handling is additive — existing `workspace:`/`file:`/`catalog:` behavior is preserved.