# every-plugin

## 2.9.4

### Patch Changes

- 785271e: Fixed error swallowing in plugin loader `tapError` logs — `register-remote`, `load-remote`, `instantiate-plugin`, and `initialize-plugin` failures now include the actual error message instead of discarding it.

## 2.9.3

### Patch Changes

- 9d17953: Fixed `tools` parameter type in plugin `initialize` — it was incorrectly typed as optional (`tools?:`) but is always provided by the plugin runtime. Child repos no longer need `tools!.buildService()` workarounds.

## 2.9.2

### Patch Changes

- 3f44bbb: Fixed SSR crash in `bos dev` with remote host and local UI without `--ssr` — the host no longer attempts SSR from the browser dev server (which doesn't serve `remoteEntry.server.js`). SSR is only attempted when an SSR URL is explicitly configured.

  Fixed silent error suppression in the host API router interceptor — `formatORPCError` output is now properly `console.error`'d, matching the publicRpcRouters pattern.

  Fixed `formatORPCError` box-drawing output to split messages on newlines and re-prefix each line with `│`, preventing misalignment when Drizzle's `Failed query` messages (which contain `\n`) are surfaced. The underlying PostgreSQL error is now visible in the error box.

  Fixed framework-level scope lifecycle bug where `Layer.scoped` resources created in plugin `initialize` with `Effect.provide(...)` were tied to a transient scope and released immediately after initialization. Database pools and other long-lived scoped resources now persist correctly.

  Added `PluginServicesTools` with a `buildService(tag, layer)` helper that builds scoped resources using `Layer.buildWithMemoMap` bound to the plugin lifecycle scope. Resources are automatically released on plugin shutdown.

  Added `registerPlugin()` lifecycle tracking — initialized plugins are now registered with `PluginLifecycleService` so `shutdown()` and `cleanup()` correctly release plugin resources.

  Fixed `evictPlugin()` cache key mismatch — eviction now uses the same key generation as `usePlugin`, so eviction correctly finds and shuts down cached plugins.

  Added a per-plugin `MemoMap` for deduplicated layer construction when using `tools.buildService`.

## 2.9.1

### Patch Changes

- eab27e7: Fix race condition in dev-server middleware: null request handlers before calling runtime.shutdown() to prevent in-flight requests from hitting dead database pools during hot reload

## 2.9.0

### Minor Changes

- b03bc24: **every-plugin:**

  - Broaden `Effect.annotateLogs({ plugin: pluginId })` to cover the full plugin lifecycle — `usePlugin`, `loadPlugin`, `instantiatePlugin`, and `initializePlugin` — so all logs including Module Federation operations and database migrations are tagged with the plugin's registry key
  - Convert Module Federation service `console.log` calls to `Effect.logDebug` (registering/loading) and `Effect.logInfo` (registered/loaded) with proper log levels
  - Refactor `formatORPCError` to return `string | null` instead of calling `console.error` directly, enabling callers to log through Effect's structured system
  - Make `toPluginRuntimeError` and `wrapORPCError` pure functions (no side effects); add `Effect.tapError` with `Effect.logError` at 4 call sites in `plugin-loader.service.ts` for plugin-aware error logging
  - Remove `formatPluginError` (dead code after purity refactor)
  - Remove redundant `Effect.annotateLogs` from `plugin-loader.service.ts` (now covered at runtime level)

  **api:**

  - Convert 3 startup `console.log` calls to `Effect.logInfo` so `[API]` startup messages gain the `plugin=api` annotation
  - Convert `Effect.log` to `Effect.logInfo` for shutdown

  **host:**

  - Import `logger` wrapper in `plugins.ts` and replace all raw `console.*` calls with `logger.*` (for async contexts) or `Effect.log*` (for Effect generator contexts)
  - Restructure `catchAll` block to `Effect.gen` for proper `Effect.logError`/`Effect.logWarning` usage
  - Fix 2 stray `console.*` calls in `program.ts` to use `logger`

  **@everything-dev/apps-plugin:**

  - Convert `console.log` to `Effect.logInfo` for startup message
  - Convert `Effect.log` to `Effect.logInfo` for shutdown

  **@every-plugin/template:**

  - Convert publish failure `console.log` to `Effect.logWarning` for proper log level and annotation
  - Remove `[Event]` debug `console.log` from streaming handler; use `getEventMeta` for meaningful event ID filtering instead
  - Restructure `getById` to `Effect.gen` wrapper with `Effect.logInfo` for service call logging

## 2.8.0

### Minor Changes

- 411121a: Add automatic plugin-aware log annotations via `Effect.annotateLogs` across the full plugin lifecycle (load, instantiate, initialize), so all logs including Module Federation operations and database migrations are tagged with the plugin's registry key.

  Convert `console.log` to Effect structured logging (`Effect.logInfo`/`Effect.logDebug`/`Effect.logError`/`Effect.logWarning`) across the framework:

  - **Module Federation service**: Registration and loading progress now use `Effect.logDebug`/`Effect.logInfo` with proper log levels
  - **Error formatting**: `formatORPCError` returns a string instead of calling `console.error` directly, enabling callers to log through Effect's structured system
  - **Error conversion**: `toPluginRuntimeError` and `wrapORPCError` are now pure functions (no side effects); call sites use `Effect.tapError` with `Effect.logError` for plugin-aware error logging
  - **Plugin templates**: Startup/shutdown logs use `Effect.logInfo`; publish failures use `Effect.logWarning`
  - **API startup**: `[API] Services Initialized` and related logs now use `Effect.logInfo` (gain `plugin=api` annotation)
  - **Host `plugins.ts`**: Uses `logger` wrapper instead of raw `console.*`; Effect-gen-context logs use `Effect.logInfo`/`Effect.logError`
  - **Host `program.ts`**: Stray `console.*` calls fixed to use `logger`

  Rename `DatabaseTag` identifier from `"api/Database"` to `"Database"` for generic correctness across API and plugin contexts.

## 2.7.1

### Patch Changes

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

## 2.7.0

### Minor Changes

- 4bffb87: Remove unused `orpc/client` export. Consumers should import directly from `@orpc/client` and `@orpc/tanstack-query` instead.
- 4bffb87: Rework shared dependency syncing to use resolved config surfaces (`app.api.shared`, `app.auth.shared`, and `plugins.*.shared`) and make host/plugin MF sharing stricter and more explicit. UI module federation sharing is now static, shared-dep conflicts fail loudly, and unresolved exact versions are rejected instead of skipped.

## 2.6.0

### Minor Changes

- d51b221: Remove unused `orpc/client` export. Consumers should import directly from `@orpc/client` and `@orpc/tanstack-query` instead.
- d51b221: Rework shared dependency syncing to use resolved config surfaces (`app.api.shared`, `app.auth.shared`, and `plugins.*.shared`) and make host/plugin MF sharing stricter and more explicit. UI module federation sharing is now static, shared-dep conflicts fail loudly, and unresolved exact versions are rejected instead of skipped.

## 2.5.11

### Patch Changes

- 46988c0: Require package typecheck and test gates before publishing framework releases, and allow manual release workflow retries even when there are no fresh changesets to consume.

## 2.5.10

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

## 2.5.9

### Patch Changes

- ffa8200: Catalog-ify rspack/rsbuild packages and propagate via bos upgrade/sync

  - Add @rspack/core, @rspack/cli, @rsbuild/core, @rsbuild/plugin-react to root package.json catalog
  - Convert all workspace package.json rspack/rsbuild deps from version ranges to catalog: refs
  - Change every-plugin @rspack/core peerDep from exact 1.7.4 to range ^1.7.4
  - Add CATALOG_TOOL_PACKAGES to manifest-normalizer for catalog: conversion during init/sync
  - Extend bos upgrade to also bump catalog tool packages to latest npm versions
  - Extend bos status to report catalog tool package versions

## 2.5.8

### Patch Changes

- cd7692f: Strengthen the generated auth surface and remove duplicate client facades so downstream packages rely on the canonical typed auth client.

## 2.5.7

### Patch Changes

- b193ad6: Fix `reqHeaders` runtime type to be a real `Headers` instance instead of `Record<string, string>`, preventing `TypeError: undefined is not a function` when calling `.get()` in plugin handlers

## 2.5.6

### Patch Changes

- 13f68ff: Inject `getRawBody` and `reqHeaders` into oRPC handler context so plugins can verify webhook signatures

  - Host session middleware now clones the request body before oRPC consumes it, exposing `getRawBody()` in context for raw body access
  - Dev server middleware also injects `reqHeaders` and `getRawBody` (previously passed `context: {}`)
  - API, projects, registry, and template plugins declare `getRawBody` in their context schemas
  - API plugin `reqHeaders` type changed from `z.custom<Record<string, string>>()` to `z.record(z.string(), z.string())` for proper runtime validation

## 2.5.5

### Patch Changes

- 7e498bb: Fix integration test exit code 99 by ensuring tests run through vitest and resources are properly disposed.

  - **CI workflow**: Changed `bun test` to `bun run test` so the CI job invokes vitest (with `--pool=forks`) instead of Bun's native test runner, which detects dangling event-loop handles and exits with code 99.
  - **Root package.json**: Updated `test:api` and `test:integration` scripts to use `bun run test`.
  - **every-plugin**: `PluginRuntime.shutdown()` now disposes the underlying Effect `ManagedRuntime` after plugin cleanup completes. A unit test that incorrectly reused the runtime mid-suite was fixed by moving shutdown into `afterAll`.
  - **api**: The PGlite database driver now properly closes the underlying `$client` when `close()` is called, preventing WASM PostgreSQL instances from staying alive after tests finish.

## 2.5.4

### Patch Changes

- 03bb4a0: Fix orchestrator crash cascade from MF DTS plugin failures.

  - `everything-dev`: Add `Effect.catchAllDefect` boundary to `dev-session.ts` so an unhandled rejection in one process (e.g., Module Federation DTS `EISDIR`) no longer tears down the entire `Effect.scoped` scope and kills all child processes.
  - `everything-dev`: Add process-level `unhandledRejection` and `uncaughtException` handlers in `orchestrator.ts` to prevent Node.js from aborting the orchestrator on internal plugin errors.
  - `every-plugin`: Add `.catch()` to the plugin dev server async IIFE in `dev-server-middleware.ts` so fatal middleware setup errors are logged instead of becoming unhandled rejections that crash the child process.

  This prevents the scenario where a TYPE-001 error in one plugin's MF DTS plugin would, within 1-2 minutes, cascade via `EISDIR` into killing the UI and all other plugins simultaneously.

## 2.5.3

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

## 2.5.2

### Patch Changes

- a38288d: Fix plugin error handling and shared dependency resolution in production.

  ### Host

  - Use `formatError()` instead of `error.message` when logging plugin initialization failures. Effect's `Data.TaggedError` has an empty `message` by default, so errors were appearing as `[Plugins] Error:` with no detail.
  - Mount a 503 stub router when the API plugin is unavailable, returning a proper JSON error body instead of an empty `{}` or 404.

  ### every-plugin

  - Re-throw non-ORPC errors from the `onError` interceptor so they propagate to the caller instead of being swallowed, which caused oRPC to serialize `undefined` as `{}`.

  ### Config

  - Move `better-auth` from `shared.plugins` to both `shared.ui` and `shared.plugins` in `bos.config.json` so it is shared correctly across both browser and server Module Federation boundaries.
  - Remove `drizzle-orm` from shared dependencies; it is an auth plugin implementation detail, not a runtime shared boundary.

## 2.5.1

### Patch Changes

- f185a6c: Remove `@opentelemetry/api` resolve.fallback stub.

  The package is now a direct dependency, so the `false` fallback workaround is no longer needed. Bundlers will resolve it normally.

## 2.5.0

### Minor Changes

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

## 2.4.3

### Patch Changes

- b20445f: Fix rspack build error: add `@opentelemetry/api` to resolve.fallback so optional peer dependency from `@better-auth/core` doesn't fail the build

## 2.4.2

### Patch Changes

- fac9cf6: Fix rspack build error: add `@opentelemetry/api` to resolve.fallback so optional peer dependency from `@better-auth/core` doesn't fail the build

## 2.4.1

### Patch Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

## 2.4.0

### Minor Changes

- 368c872: Improve plugin lifecycle cleanup, add additionalExports, and share BosConfigInput

  Plugin shutdown now logs warnings instead of silently swallowing errors. DB layers use Effect acquireRelease for proper connection cleanup. Build system supports additionalExports for bundling extra type files. BosConfigInput is now exported from everything-dev/types for shared use. Registry plugin validates private key format before creating relay clients.

## 2.3.0

### Minor Changes

- d96b5d3: Enforce effect and zod as singleton shared dependencies across Module Federation runtime

  - Add `effect` and `zod` as direct dependencies in api, host, and ui packages with catalog-pinned exact versions
  - Move `every-plugin` from devDependencies to dependencies in api and ui (runtime import)
  - Add `effect` and `zod` to `bos.config.json` `shared.ui` as singleton MF shared deps to prevent duplicate runtime instances
  - Pin `effect`, `zod`, and `@orpc/*` to exact versions in workspace catalog and add overrides to eliminate version drift
  - Unify `@orpc/*` version refs across api, host, and ui to use catalog instead of mixed ranges
  - Update `every-plugin` mf-config to resolve effect/zod versions from installed packages instead of hardcoded ranges
  - Merge `overrides` field in sync flow's `mergePackageJson` to preserve user overrides during upgrade

## 2.2.6

### Patch Changes

- 466664d: Strip `development` exports conditions from published package and override rspack `conditionNames` to prevent resolving to `.ts` source files in npm-installed projects

## 2.2.5

### Patch Changes

- f276764: Fix Docker image to install framework packages from npm instead of local symlinks

## 2.2.4

### Patch Changes

- ce2c9fe: Fix `z.object().loose()` TypeError — replaced with valid Zod v3 method `.passthrough()`

## 2.2.3

### Patch Changes

- 2b86efd: Fix npm manifests — resolve workspace/catalog refs for published packages

## 2.2.2

### Patch Changes

- 1859d7f: Fix npm trusted publishing provenance verification by aligning package repository metadata with the GitHub repository URL.

## 2.2.1

### Patch Changes

- 01aec75: Fix npm publish: `main`, `module`, and `types` fields must be strings

  npm requires `main`, `module`, and `types` to be plain strings, not conditional objects. The conditional resolution is handled by the `exports` field, so these fields now point to production defaults (`./dist/*`).

## 2.2.0

### Minor Changes

- 5edf2fa: Rewrite package exports to dual conditional format (`development` → source, default → dist). Add `buildEverythingDevQuietly()` to CLI to ensure dist is built before workspace builds. Add missing tsdown entries for `every-plugin/orpc/client` and `every-plugin/orpc/openapi`. Add `prepublishOnly` and `customConditions: ["development"]` to all consumer tsconfigs. Move re-exported `@orpc/*` packages to `peerDependencies` in `every-plugin`.

## 2.1.0

### Minor Changes

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

### Patch Changes

- 8e378e3: Update plugin build system: rspack config format and shared-deps resolution

  - Rspack config format changes for plugin template
  - Shared dependencies resolution updates

## 2.0.0

### Major Changes

- 5524246: Refactor CLI and plugin orchestration: remove standalone `packages/cli`, absorb its responsibilities into `everything-dev`, restructure the BOS plugin and contract generation pipeline, overhaul the API registry, and update the plugin build system with a new rspack config format and data-URI fix.

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0

### Patch Changes

- 44393e7: Add plugin support with improved module federation service, shared dependencies handling, and auth client integration
