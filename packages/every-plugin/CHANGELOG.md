# every-plugin

## 3.0.0-rc.0

### Major Changes

- d57b8f4: Upgrade build toolchain to Rspack 2.2 / Rsbuild 2.2 / Module Federation 2.9

  Version catalog bumps: @rspack/core + @rspack/cli → 2.2.6, @rsbuild/core → 2.2.8,
  @rsbuild/plugin-react → 2.1.0, @module-federation/\* → latest 2.x (enhanced 2.9.0,
  node 2.7.50). @module-federation/runtime-tools and @rspack/dev-server are now
  explicit dependencies where used.

  BREAKING (every-plugin): EveryPluginDevServer removed from every-plugin/build/rspack.
  Plugin dev serving is now standalone — `every-plugin-serve` (supervised
  `rspack build --watch` + plain node:http server with the same contract: health,
  remoteEntry statics, oRPC RPC/OpenAPI, sibling composition, effect context).
  Plugin dev scripts use `every-plugin-serve` instead of `rspack serve`.
  EveryPluginBuild carries the build-side responsibilities only.

  Deploy note: `bos mf check` compares host and remote pluginVersion exactly, so
  after the 2.9.0 host deploys, remote-only plugins must be redeployed on
  Module Federation 2.9.0 to stay compatible.

- d57b8f4: Adopt the Effect DevTools toolchain: native TypeScript 7 (`@effect/tsgo`) with the Effect language-service plugin, and Oxlint with type-aware Effect rules.

  TypeScript peer/dev ranges are narrowed to `^7.0.2` (no more `^5` support): `every-plugin`, `better-near-auth`, and `@everything-dev/auth-plugin` now require TypeScript 7, and `everything-dev` moves its devDependency to `^7.0.2`. Builds are unaffected (rspack/rsbuild transpile); typechecks and the editor language service run on the patched TS 7 native compiler.

  TS 7 compatibility fixes: the test-plugin fixture consumes the built `every-plugin` declarations, and a new root `tsconfig.base.json` consolidates shared compiler options across parent-owned workspace tsconfigs (scaffolded `ui/`/`api/`/`plugins/*` tsconfigs stay self-contained since they are copied verbatim into child projects).

  Contract declarations move into the plugin build entirely: `every-plugin build`/`deploy`/`dev` regenerate `types/contract.d.ts` from `src/contract.ts` via the patched TypeScript 7 binary whenever it is stale (rspack watch keeps dev types fresh automatically), and `EmitPluginManifest` embeds the fresh file with a verified sha256. The per-workspace `tsconfig.contract.json` files are removed — `bos sync` migrates child projects, and `every-plugin types` regenerates manually. `bos typecheck` now regenerates client-stub types itself before type-checking, so the root `types:gen` script is gone. Remote plugin-manifest fetches during `types gen` retry on transient network failures.

- d57b8f4: Effect-native plugins: `.effect()` handlers, Layer-returning `initialize`, router merging, and direct package imports. Implements `plans/infra/effect-native-plugins.md` (the handler-idiom half of the oRPC v2 + Effect 4 migration).

  **every-plugin — breaking `createPlugin` API**

  - `initialize` returns an Effect `Layer` instead of a deps record. The runtime builds the Layer in the plugin's lifecycle scope and exposes services through the oRPC context (`effect/context`), so handlers access them with `yield* Tag` in `.effect()` generators or `Context.get(context["effect/context"], Tag)` in plain/streaming handlers. `Layer.buildWithScope` + `Context.get` extraction in plugin code is gone.
  - `createRouter(builder, plugins)` — the deps parameter is removed. Sibling plugin entries in `plugins` carry `{ client, router }` for cross-plugin router merging (nesting a sibling's router also surfaces its routes in the host's OpenAPI spec and MCP tools).
  - `shutdown` is removed — Layer finalizers scoped to the plugin handle teardown.
  - New optional `servicesTag` on the plugin definition lets the host read a plugin's services from the built Effect context without importing the plugin module (used by the host to mount the auth plugin's Better Auth handler).
  - `@orpc/experimental-effect` (`.effect()` builder extension) and `@orpc/openapi` `.route()` extension are pre-loaded by the runtime; plugins import `oc`, `ORPCError`, `zod`, `effect` directly and the `every-plugin/orpc`, `every-plugin/effect`, `every-plugin/zod` re-export barrels (plus the `runEffect`/`flattenError` bridges) are deleted.
  - `@orpc/openapi`, `@orpc/experimental-effect`, and `@orpc/publisher` are now Module Federation shared singletons.
  - `InitializedPlugin.context` (deps record) is replaced by `InitializedPlugin.effectContext`; `usePlugin`'s `createClient` injects `effect/context` so server-side/SSR calls work with `.effect()` handlers.

  **Host**

  - `/api/rpc/*` and `/api` handlers inject the serving plugin's Effect context; the base API handler receives the merged context of all initialized plugins so merged sub-routers resolve their own services. MCP tool invocations get the same injection.

  **API plugin**

  - The four template-plugin passthrough handlers and their re-declared schemas are deleted; the template router is merged directly as `things`, so its routes appear under `/api` OpenAPI docs and MCP automatically.

  **Plugins**

  - `_template` (reference implementation), `apps`, `auth`, `proposals`, and `votes` migrated to the new API. Streaming handlers stay async generators and read services synchronously from the injected Effect context.
  - `bos upgrade`'s `ensureEffectImports` codemod now rewrites legacy `every-plugin/effect` imports to `effect` directly.

  **Atomic deploy required** — unchanged from the parent migration: old remote plugins are incompatible and all remotes must be redeployed together (`bos publish --deploy`).

- d57b8f4: Migrate the framework to Effect 4 (`4.0.0-rc.112`) and oRPC v2 (`2.0.0-beta.35`).

  **every-plugin**

  - Layer-based plugin `initialize`: services are built with `Layer.mergeAll` + `Layer.buildWithScope` inside an `Effect.gen`, replacing the removed `tools.buildService` API. `PluginServicesTools` is gone.
  - `Context.Tag` replaced by `Context.Service<Self, Shape>()("id")` throughout.
  - Effect 4 API migration: `Effect.either` removed (use tagged results or `runPromiseExit`), `Effect.catchAll` → `Effect.catch`, `Effect.async` → `Effect.callback`, `Layer.scoped` → `Layer.effect`, `Cause.isInterruptedOnly` → `Cause.hasInterruptsOnly`, `Fiber.RuntimeFiber` → `Fiber.Fiber`.
  - `PLUGIN_ERROR_STATUS_MAP` now spreads oRPC v2's `COMMON_ERROR_STATUS_MAP` (providing a map replaces the default entirely) and keeps the v1 TIMEOUT → 504 / CONNECTION_ERROR → 502 overrides.
  - `getMajorMinorVersion` preserves prerelease segments (`4.0.0-rc.112` → `^4.0.0-rc.112`) so Module Federation requiredVersion ranges keep host/plugin lockstep on RC builds.
  - Publisher retention option renamed to `resume: { enabled, seconds }`.

  **everything-dev**

  - CLI runtime fully migrated to Effect 4; the orchestrator no longer depends on `@effect/platform`/`@effect/experimental` (no Effect 4 release) and spawns processes via `child_process.spawn` with `Effect.callback` exit handling and `Stream.fromReadableStream` output pipelines.
  - `bos upgrade` codemod rewrites `Effect.provide(Layer)` call sites to the v4 `Layer.buildWithScope` + `Context.get` pattern and emits balanced-import rewrites.
  - Contract parsing reads zod 4 schema internals (`def` instead of `_def`) and oRPC v2 `~orpc.inputSchemas[0]`, fixing boolean/negated flag parsing.

  **Host / API / plugins / UI**

  - All workspaces on the same Effect 4 + oRPC v2 versions via the catalog. oRPC v2 OpenAPI generator/reference plugin wiring, RPCLink `origin`/`url` split, `errorStatusMap` on all handlers.
  - Breaking change for deployed remotes: hosts and plugins must be redeployed together (`bos publish --deploy`). v1 remote bundles are incompatible with the v2 host.

- d57b8f4: Export map is now generated from the tsdown entry table, and the dead build surface is gone.

  **every-plugin**: the `package.json` exports map's `bun`/`development` blocks are stamped from `tsdown-entries.ts` — one table is the source of truth for the tsdown entry list and the export subpaths (`bun run --cwd packages/every-plugin exports:sync` to stamp, `exports:check` for CI; a unit test pins the stamp, and `tsdown` self-stamps on every build). Resolution semantics are unchanged: `bun`/`development` still resolve `src/`, default still resolves `dist/` (ADR 0018). Removed with zero in-repo callers: the `every-plugin/testing` export (never imported), `RuntimeOptions` (never read), the public `EveryPluginComposedBuild` / `EveryPluginComposedBuildOptions` re-exports (the composed stack stays, internal to `createPluginBaseConfig`; no custom stacks exist), the `additionalExports` build option in `EmitPluginManifest` (manifest _consumption_ of `additionalExports` from deployed plugins is untouched), and the deprecated `CommonPluginErrors` alias (use `PluginErrors` or individual imports). Consumers of deployed-plugin manifests are unaffected.

  **everything-dev**: internal refactor only — the three near-identical prerequisite builders collapse into one `buildPackageQuietly(cwd, packageName, force)`; `buildWorkspaceTargets` and the `bos dev` boot build are unchanged in behavior, and the regression prod-stack runner (image-stage builds via `scripts/regression/container-build.ts` / the `bos build` CLI) is untouched.

- d57b8f4: Plugin identity unified and shared dependencies specified once.

  **every-plugin**: new `every-plugin/identity` — one derivation for npm/remote/container names from the config layout key (`remoteName`, `containerName`, `identity`, `pluginLayoutKey`, `resolveDevPluginId`); `plugin.dev.ts` no longer carries `pluginId` (the dev server derives it from the workspace `package.json`, fixing the `dependsOn` sibling lookup). New `every-plugin/shared-deps-spec` — the canonical shared-dependency lists, criticality, and version resolution; unresolved versions now **fail the build loudly** (`SharedDependencyResolutionError`) instead of silently degrading to `*`/`latest` and disabling the strict-singleton guard; all four consumers (rspack, rsbuild, runtime mf-config, host pre-registration) derive from it. The `apps` plugin is renamed `registry` (dir, package `@everything-dev/registry-plugin`, config attachment key `plugins.registry`, `apiClient.registry.*`) — the attachment-key rename is a published-config break; land it with the bundle deploy.

  **everything-dev**: consumes both modules; scaffold (`_template`) stops emitting `pluginId`.

- 9191ab3: pnpm/node runtime alignment (ADR 0026)

  - The `every-plugin` CLI bins are node-first: the dist path runs plain node,
    and the bootstrap tsx fallback (fresh checkout, no dist yet) passes
    `--conditions=development` so the config chain resolves source over a dist
    that does not exist yet. Emitted bin shebangs are `#!/usr/bin/env node`.
  - `every-plugin/identity` inside the rspack config chain resolves relatively
    (a package self-import fell through to the default condition and hit a
    missing dist under node).
  - `PLUGIN_VERSION` reads the package manifest via `node:fs` — the previous
    `createRequire(import.meta.url)` came up empty under tsx in spawned
    processes, reading 0.0.0 and tripping the shared-identity check.
  - `exports:sync`, `build:test`, and the integration test scripts run through
    node/tsx/pnpm; `@types/bun` and `bun-types` are dropped.

### Minor Changes

- d57b8f4: Atomic deploys phase A (tickets 01-02 of .scratch/atomic-deploys): builds emit content-hashed entrypoints (`remoteEntry.[contenthash].js`, `remoteEntry.server.[contenthash].js`), immutable hashed `mf-manifest.json` and `style.css` copies, and a per-dist `build-report.json` for the deploy leg — fixed-name entry aliases are fully retired (hard break; dev servers keep the fixed dev names as the dev serving contract). Bundle cache classification now treats any content-hashed name as immutable regardless of base name. New `every-plugin/version-manifest` export defines the immutable per-deploy `WorkspaceVersionManifest` document, and config slots accept a `manifest` pointer (versioned manifest filename) — the deploy unit for atomic, additive deploys.
- d57b8f4: Atomic deploys phase A completed (tickets 03-04 of .scratch/atomic-deploys): the deploy leg now composes an immutable per-workspace version manifest from the server-computed SRI map, uploads it additively at `versions/<id>.json`, and pins slots by manifest pointer (`manifest` + the manifest's SRI) — a dist that cannot pin (no build report / no entry SRI) aborts the train instead of writing fallback pointer entries (hard break). Upload transport hardened: status-0 retries on fresh connections (`connection: close`, 5 attempts, backoff+jitter), retryable statuses capped at 3. Resolution derives entry-level fields (`entryUrl`, hashed browser-manifest `entry`, entry SRI, `ssrEntryUrl`) from the version manifest behind a content-addressed per-pin cache; consumers (host html/head/ui-compose/plugins SSR loads/federation SSR entries/mf type inference, hydrate manifest registration) prefer the derived hashed URLs with fixed-name fallbacks only for dev and local slots.
- 95261fe: Finish ADR 0023: the generated bootstrap stubs now read two authored override exports from `ui/src/app.ts` — `appLocale` (SSR locale negotiation: locales, defaultLocale, cookieName) and `apiConnectionError` (localized API connection-failure toast copy). Default error/pending/not-found components are set inside the authored `createRouter` factory in `ui/src/router.tsx`. Hard break to v2: children that hand-customized `hydrate.tsx` / `router.server.tsx` get them backed up and deleted by `bos sync`/`bos upgrade`, and must port the customizations into the authored seams (the sync output prints the port guide; originals land in `.bos/sync-backup/<timestamp>/`).
- d57b8f4: Add `buildScoped(tag, layer)` and `buildScopedContext(layer)` helpers for building scoped resources inside plugin `initialize` (replaces the hand-written `Layer.buildWithScope` + `Effect.scope` + `Context.get` incantation), and export a `PluginEnv` alias for the `initialize` effect's environment (`Scope.Scope | PluginIdTag`).
- f151e1b: Differential bundle uploads: each deploy's version manifest now records the dist's full per-file SRI map (`files`), the next deploy hashes its local dist against it and re-uploads only new or changed files. Previous pins resolve from a new `.bos/deploy-state.json` pointer (written after every confirmed publish) with the published config as fallback; any unusable previous manifest degrades to a full upload. `--full-upload` / `BOS_FULL_UPLOAD=1` bypasses the diff.
- 9191ab3: Declare the shipped surface's real runtime dependencies

  Under Bun's `bun` export condition (and node's `development` condition), every-plugin resolves from source, so every value import in the shipped `src` graph is a runtime dependency — and the build surface (`build/ui`, `build/rspack`, `ui/manifest-generator`, `dev`) is part of that graph. The following were resolvable only through hoisting luck or misdeclared as peers and are now proper `dependencies`:

  - `@tanstack/router-generator` (was undeclared entirely — crashed at boot once the image's node_modules was pruned)
  - `@module-federation/rsbuild-plugin` (was a peer; value-imported by `build/ui/rsbuild-config.ts`)
  - `sirv` (was undeclared; used by `dev/serve.ts`)
  - `@rsbuild/core`, `@rsbuild/plugin-react`, `@tanstack/router-plugin` (were peers; value-imported by the build/ui factories)

  `@rspack/core` stays a peer — its imports in the shipped surface are type-only.

- d57b8f4: Complete folder-form plugin UI sources: a `ui/` directory with route files but no own `package.json` is now built entirely by the plugin's `every-plugin dev`/`build` (a generated rsbuild config under `.every-plugin/`), replacing the separate plugin-ui workspace.

  - Dev orchestrator passes `BOS_UI_PORT` to the plugin dev process — including the auth app slot, whose `plugin:auth` descriptor is never spawned — so the plugin ui dev server always listens on the port the runtime config advertises (previously it auto-picked a port, breaking client-side compose of plugin routes)
  - Folder-form ui builds output to the ui source root's `dist/` (web + `ssr/` containers), matching what the host's local SSR container server and manifest reads expect
  - Generated rsbuild config now carries a `deployLabel`
  - `bos dev` warns and suggests a single restart when its build step finds the everything-dev dist stale — the running CLI keeps the previously imported build, so orchestrator changes are one session behind without it
  - New `csr` browser-regression mode (`regression:start:csr` / `test:regression:browser:csr`): the dev stack without `--ssr`, running a focused spec set that pins client-side manifest composition of plugin routes (including a no-CSP-violation assertion) — the default dev path was previously untested by the regression suite

- f9d2dce: Manifest contract v2 (ADR 0024): route records adopt the TanStack virtual-file-routes vocabulary — `type: "route" | "layout" | "index"` replaces the `isLayout`/`isIndex` booleans — and the manifest version is enforced at every load: the host's manifest loads and the client's compose-payload parse reject a skewed major with one diagnostic (a version-skewed payload degrades to the core-only tree instead of silently mis-constructing). The folder-form ui's composition key now derives solely from the `plugins/<key>` layout — a non-derivable key fails the build loudly instead of silently falling back to the container name (the drift that mis-keyed manifests). Mount registry version bumps to 5, invalidating all compose digests once.
- d57b8f4: No-watch regression stacks: `BOS_NO_WATCH=1` makes every local service build once and serve the built output instead of running rspack/rsbuild watchers — the regression suite needs no hot reload, and the watchers were the stack's heaviest processes (freezing shared CI runners under their accumulated footprint ~26 tests in). Plugin API services run a one-shot `rspack build` and serve `dist` statically; folder-form ui sources build once and serve the ui source root's `dist` on `BOS_UI_PORT`; the core ui gains a `dev:built` script (`rsbuild build && rsbuild preview`). Local `bos dev` stays watch-mode. The CI regression suite also splits into two parallel jobs (SSR + CSR), each with its own 20-minute budget and a resource watchdog logging memory/top processes to the failure artifacts.
- d57b8f4: Plugin build framework consolidation: `EveryPluginComposedBuild` (the rspack stack — manifest emission + Module Federation + MF data-URI fix — in one composed plugin) and `createPluginBaseConfig()` replace per-workspace config boilerplate. New `every-plugin <dev|types|build|deploy>` CLI is the plugin package contract, absorbing the `build:types → tsc → rspack` chain; per-workspace scripts shrink to one-liners and `every-plugin-serve` bin is a single source import. Per-workspace `rspack.config.js` files are deleted — the CLI synthesizes the composed config (opt-in typed `build.config.ts` overrides). `deploy` builds the same as `build` — deploy URLs are written by `bos publish --deploy` (image-native), not by build hooks.
- d57b8f4: One shared Effect-native plugin-load retry policy (`loadRemoteWithRetry`): capped exponential backoff bounded by a wall-clock budget, per-attempt failure logging deduped by classification signature, the poisoned global entry cache purged between attempts, and fail-fast on permanent failures (`classifyPluginFailure().retryable` — MF identity skew, schema validation, dead remotes, TLS verification) instead of silently burning the budget. `withRemoteEntryResilience` and the dev-server's duplicate loop are absorbed by it. MF service logs now read `[MF][<pluginId>] ✅ Registered` / `✅ Loaded constructor` (plugin id no longer duplicated as a log annotation).
- d57b8f4: Purge the stale public surface: delete dead every-plugin exports (`PluginMetadataRegistry`, `LegacyPluginRuntimeConfig`, `PluginConstructor`, `ERROR_PATTERNS`, `getPluginSharedDependenciesVersionRange`, and the deprecated `createLocalPluginRuntime` / `createTestPluginRuntime` / `PluginMap` / `InferBindingsFromMap` testing helpers), restore the `bos upgrade` legacy dist-import rewrite to its original `everything-dev/dist/` → `everything-dev/` pattern (the mapping table had degenerated to an identity rewrite that could never fire), and replace the dead subaccount workflow in generated child AGENTS.md with the DAO-owned tenant flow.
- d57b8f4: Fix the recurring post-sign-in redirect loop structurally: the session read path and auth redirect policy now have one owner (`everything-dev/ui/auth`), shared across the core ui and plugin ui remotes as a strict Module Federation singleton. A mixed deploy can no longer run two divergent session-read copies whose guard decisions disagree into "Too many redirects" — the login guard and the authenticated guard read through exactly one module, and a version mismatch fails loudly at load instead of silently loading a second copy. Child projects receive the consolidated guards via `bos sync` (`ui/src/lib/auth-guards.ts`, `ui/src/lib/plugin-path.ts`, and the plugin's drifted `session-cache.ts` copy exit sync ownership). See ADR 0018.

  Also kills the silent dist-staleness class for build tooling: the bundler-configuration factories (`every-plugin/ui/mf-build`, `every-plugin/build/rspack`) resolve from source under bun (the workspace runtime) while node/npm consumers resolve the immutable published dist, and the `everything-dev/ui/mf-build` re-export shim is deleted (`ui/rsbuild.config.ts` imports `every-plugin/ui/mf-build` directly, like the generated plugin configs already do). Shipped code still resolves dist, with `bos build`/`bos deploy` unconditionally staleness-checking the framework prerequisites before any target — the train is the only supported build path.

- d57b8f4: Source-first local dev for the framework packages plus quieter builds.

  **every-plugin**

  - Silenced route-generator build warnings: colocated `*.test`/`*.spec` route files are excluded from route scans via `routeFileIgnorePattern` (prefix with `-` to fully opt out), and the node-environment UI build no longer races the web environment writing `src/routeTree.gen.ts` (its write goes to a scratch path).
  - `every-plugin dev` re-execs with `--conditions=development` (guarded by `EVERY_PLUGIN_DEV_CONDITIONS=1`) so the runtime resolves framework packages from TS source.
  - Plugin rspack builds resolve `every-plugin`/`everything-dev`/`better-near-auth` through the `development` export condition (TS source) for all local flows; the gate is `DEPLOY !== "true"` (the rspack CLI defaults NODE_ENV to production even for dev watch). Adds json and `.js`→`.ts` extensionAlias rules to make source-resolved packages (package.json imports, node-style specifiers) bundler-compatible. Deploy builds keep the dist-first snapshot that ships.

  **everything-dev**

  - `bos dev` spawns services with `bun --conditions=development`, so bun-runtime chains (plugin dev servers, MF runtime requires) consume framework sources directly; the host dev server gets `NODE_OPTIONS=--conditions=development` (tsx is TS-capable node).
  - Root `dev*`/`bos` scripts run the CLI with the development condition, so the CLI itself starts from source on fresh clones without a prebuilt dist.
  - The quiet dist rebuilds at `bos dev` bootstrap remain: rsbuild/rspack config loaders (jiti / native `.mjs` import) are conditions-inert and require dist.

- f5f1a5f: Serve the platform skill family from the core UI build — `node_modules/{everything-dev,every-plugin,better-near-auth}/skills` copy into `dist/skills/<package>/` and are reachable at `/skills/<package>/<skill>/SKILL.md` (with the rest of the family listed from `/skill.md`). Children get the same copies from the published npm tarballs.
- d57b8f4: The slot pin gets an explicit representation: config slots carry
  `pin: { manifest, integrity }` (the versioned WorkspaceVersionManifest
  filename + that document's SRI) instead of the overloaded flat pair — the
  top-level `integrity` is now always a direct entry SRI, only for unpinned
  fixed-name slots. Breaking: the flat `manifest` key is retired (deploy
  write-backs scrub it), and outside development every remote slot MUST pin a
  version manifest — an unpinned remote slot fails config resolution loudly
  (pre-pin configs are pre-atomic-deploy and not servable). Fixed-name entry
  fallbacks are development-only at every consumer (host html shell, head
  scripts, SSR entry loads, compose webEntry); a production slot without a
  derived `entryUrl` fails loudly. Extends merge treats the pin atomically (a
  child pin replaces the parent's whole). Also adds `resolveEntryUrlForEnv`
  to `every-plugin/ui/manifest` — the shared consumer contract for entry-URL
  resolution.
- f9d2dce: The core ui's bootstrap stubs are now generated, not authored: the web entry, hydrate bootstrap, SSR router module, compose expose, and globals are emitted as `.gen`-suffixed, gitignored files by the framework's code-artifact generation pass (`bos dev`/`build`/`typecheck`), regenerated from the installed package version. The build surface retargets to the generated paths and core-ui detection no longer requires an entry stub. Sync drops the retired stub files from its ownership list and tolerates templates that no longer ship a file. Per ADR 0023.

### Patch Changes

- d57b8f4: Compile login catalogs before loading them into Lingui, preserve the NEP-413 callback URL throughout wallet signing and verification, and keep local plugin manifests and source-first runtime loading working on Windows.
- d57b8f4: Fix `every-plugin dev` after per-workspace rspack config deletion: the dev server spawned a bare `rspack build --watch` with no config, falling back to rspack defaults (entry `./src`, no `.ts` resolve extensions) so every local plugin's watch build failed with `Can't resolve './src'`. The generated-config synthesis from the CLI (`build`/`deploy` paths) is now shared (`ensureGeneratedRspackConfig`) and the dev watcher passes `--config .every-plugin/rspack.config.generated.mjs` (bare `rspack build --watch` remains for workspaces that ship their own `rspack.config.js`).
- c520871: Harden error rendering: unknown throwables (symbols, objects, unserializable values) stringify safely in runtime error messages and plugin-load logs instead of throwing or printing `[object Object]`.
- 9191ab3: Bin scripts run on node

  `every-plugin` / `every-plugin-serve` bins drop the bun shebang: they re-exec through tsx (dev carries the `development` export condition), and non-dev commands run the built `dist/cli.cjs` when present — falling back to tsx + src only for the fresh-checkout bootstrap build.

- 4d8efd1: Fix stale `metadata.sources` in the `plugin-client` and `plugin-testing` skills (`api/src/lib/auth.ts` → the auth-middleware module, `src/testing/index.ts` → the runtime entry).
- d57b8f4: Fix dev/regression builds shipping hashed MF entry names, and make the regression start fixture pin its slots. `isBuildInvocation` now keys on an explicit `BOS_DEV_SERVER=1` stamp (dev servers mark their own bundler children) instead of NODE_ENV/DEPLOY — vitest's `test` env and the bundler CLIs' `production` default can no longer misclassify a dev server, and every non-dev build (local, host-test, container, deploy) emits content-hashed entries + build reports. The host rsbuild config adopts the same hashed-entry + report contract, making `app.host` pinnable by the deploy train. Slot pins resolve against the slot's remote base (`remoteUrl`), not the host's listening URL. The regression container-build composes per-slot version manifests (local SRI) and stamps `pin: {manifest, integrity}` into the variant configs — ADR 0009 amendment: pins are the only production slot shape — and the version manifests' `ssr.entry` carries its `ssr/` path segment so derived `ssrEntryUrl` points at the real bytes.
- f151e1b: FixMfDataUriPlugin now resolves what it rewrites. The data-URI normalizer strips machine-absolute `node_modules` prefixes from generated runtime imports (MF runtime, rsbuild's HMR entry) and records each bare specifier's on-disk target, then redirects resolution back through a NormalModuleFactory `resolve` tap. This replaces the hardcoded `mfDataUriAliases()` list, which missed specifiers it didn't know about — `@rsbuild/core@2.2.8`'s exports map doesn't expose `./dist/client/hmr.js`, so any workspace with a browser dev build (ui, auth, ai) failed with `Package subpath './dist/client/hmr.js' is not defined by "exports"` immediately after "Rspack compiled successfully". Module ids stay machine-independent: the request remains the bare specifier; only the resolution target is machine-specific.
- d57b8f4: Fix the folder-form no-watch UI static server: it derived the dist directory from `path.dirname(cwd)` — serving `<parent>/ui/dist`, a directory that does not exist for plugins under `plugins/<id>/` — while the generated rsbuild config (correctly) writes `<cwd>/ui/dist`. Every asset 404'd, so the browser's manifest-driven remote registration failed and client composition silently fell back to the core-only route tree (plugin routes like `/login` and `/settings` vanished into the `_public/$accountId` catch-all). The server now also fails loud at listen time when the built UI dist is missing.
- d57b8f4: Composed routes now keep their authored route contract. The generated `routeConfig.gen.ts` and `constructTree` carry `validateSearch`, `search` middlewares, `params`, `loaderDeps`, `context`, `ssr`, `staleTime`, `gcTime`, `preloadStaleTime`, `pendingMs`, `pendingMinMs` and `shouldReload` alongside the loader, head, static data and components they already passed, for plugin routes, mount layouts and the core root route. Previously these were dropped, so search validation (including redirect sanitization) in plugin routes was not applied, `loaderDeps` never reached loaders, and `ssr: false` routes were server-rendered. Route configs are regenerated by `every-plugin build` / `bos dev`; deployed UI remotes pick up the fix once rebuilt and republished.
- d57b8f4: The plugin dev server's build watchers (`rspack build --watch`, `rsbuild dev`) are now killed with SIGTERM-then-SIGKILL escalation on shutdown — rspack's watch mode ignores SIGTERM, so previously every non-graceful dev session left its watchers orphaned (reparented to PID 1, invisible to `bos kill --all`, squatting CPU and file watchers forever). The dev server also watches its own parent process and tears down (with the same escalation) if the wrapper chain above it dies, matching the orchestrator's orphan-watch behavior.
- 784fcad: Restore the v1-proven core sharing set: `@orpc/openapi`, `@orpc/experimental-effect`, and `@orpc/publisher` leave `CORE_SHARED_DEPS` and the runtime's core module loaders. Consuming them through the share scope crashed every plugin bundle that imports them at runtime (`__webpack_modules__[r] is not a function` — the runtime's `import()`-based provide hands the rspack consumer an ESM namespace object where a module factory is expected; the first-ever runtime load of this bundle generation failed on six of seven plugins, and template only survived because it is the one workspace that does not import `@orpc/openapi`). They are declared in each workspace's `package.json` (the phantom-dep fix stays) and are bundled per workspace instead, matching v1's proven production shape. Also logs the failing error's stack alongside the classified message in the plugin-load retry reporter — the message alone turned this diagnosis into hours.
- d57b8f4: Reuse plugin initialization and routers for equivalent configuration, evict failed instances, and release scopes even when initialization or shutdown defects.
- d57b8f4: Establish strict version identity for Module Federation shared dependencies to eliminate silent Effect-RC cross-bundle skew.

  The effect-critical shared deps (`every-plugin`, `effect`, `@orpc/contract`, `@orpc/server`, `@orpc/client`, `@orpc/experimental-effect`), now carry exact `requiredVersion` (the installed version) with `strictVersion: true`, single-sourced from every-plugin's shared-deps module across bundle-time, runtime pre-registration, and the host build. `bos mf check` compares bundle versions exactly for these deps and treats non-caret constraints as exact matches. The plugin loader rejects a remote whose mf-manifest.json shared identity disagrees with the local runtime (`BOS_MF_IDENTITY=warn` opts out to warn-and-load), and skipped plugins surface in /api/\_health with full detail. Deploy workflow gates Railway redeploys on `bos mf check` so an inconsistent release train fails CI.

- c23dfb6: Fix plugin load failures under rspack 2.2.8 + MF runtime 2.9.x ("**webpack_modules**[r] is not a function"):

  - The build composition disables `optimization.splitChunks`, which re-ids the
    final chunk graph while the federation get-factory codegen keeps pre-split
    ids — emitted container entries then eagerly load chunks that were never
    emitted. A new `ChunkCompletenessPlugin` fails the build loudly if any entry
    references an unemitted chunk, so the regression can never ship silently.
  - The runtime service now registers and loads remotes under the container's
    own name (`mf-manifest.json` metaData.name). The node runtime's chunk
    loader falls back to resolving chunk URLs from the remote's entry URL keyed
    by that self name; a mismatch made the fallback miss, `resolveUrl` return
    null, and the loader hand back an empty chunk as if it had loaded — the
    exposed module then required ids nothing registered. An integration test
    registers the fixture under a mismatched alias key to pin this.
  - Module ids are now named (context-relative requests) instead of
    rspack's default deterministic hashes, which fold machine-absolute paths
    into the id space: the same source built different ids on the host deploy
    train and inside the image's dist-builder stage, so a mixed-generation
    load (CDN-pinned entry + staged chunks) spliced two incompatible id
    spaces. FixMfDataUriPlugin now also rewrites the data-URI runtime module's
    machine-absolute node_modules imports to bare specifiers, with resolve
    aliases restoring on-disk resolution.

- ed70808: Two-database contract: production deployments now need only `AUTH_DATABASE_URL` and `API_DATABASE_URL`; plugin `*_DATABASE_URL` secrets fall back to the shared API database (per-plugin tables isolate in `plugin_<slug>` schemas). Explicit per-plugin values still win.

  - `bos start` no longer manufactures `.env`/`.env.example`/`.env.test` at boot — the production container previously generated a dev-convention `.env` (localhost Postgres URLs) and dotenv-loaded it, feeding plugin DB secrets unreachable URLs (`ECONNREFUSED`). `bos start` only loads an operator-provided `.env`; `bos dev`/`bos init` keep the bootstrap.
  - Plugin `*_DATABASE_URL` secrets missing from the host environment resolve to `API_DATABASE_URL` (host plugin composition).
  - Generated `.env.example` omits plugin database secrets (they are fallback-covered); `.env.test` keeps explicit test-database values for isolation.

- 8a06f6b: Introduce typed Effect errors across host, CLI, and plugin runtimes. `every-plugin`'s `Plugin.initialize` contract now types its layer error channel as `Error` and its failure channel as `PluginRuntimeError` (mapped via `toPluginRuntimeError`), and `PluginRuntimeError` exposes a readable message. `everything-dev` gains exported `OrchestratorError` and `encodeRuntimeConfig` — `BOS_RUNTIME_CONFIG` is now schema-encoded with undefined fields omitted (undefined array entries become null) instead of raw `JSON.stringify` — plus tagged error conversions in migrations, preflight, integrity, near-cli, and storage-upload, and schema-validated migration journal loading.
- f9d2dce: Trim the core ui's declared MF surface to consumed exposes (drop `./providers` and `./hooks`), construct the core-only tree on the client when a deployment carries no compose payload or a malformed one (plugin-free CSR apps no longer crash on "no route tree"), and correct ownership headers. The ui globals ambient file is trimmed to the rsbuild types reference.

## 2.10.1

### Patch Changes

- ada1cd2: Remove `_viewer` paths from the host and add structured error testing surface.

  - Remove `_viewer` route, `renderBosViewer`, `isViewerFramePath`, and viewer-specific CSP/font-src conditionals from the host; always apply `frame-ancestors 'none'`
  - Rate limiter no longer skips the `/health` path, protecting it from DDoS
  - Add `testError` route to the core API shell with six error kinds (`unauthorized`, `forbidden`, `not_found`, `conflict`, `bad_request`, `internal`), returning structured JSON errors with correct status codes and content types
  - Add `testError` route to the `@every-plugin/template` plugin as a demonstration
  - Append template plugin's thing routes (`/api/things`) to the API router with `requireAuth`, restoring the host-level `/api/things` surface via `_plugins.template()` passthrough
  - Add regression tests verifying structured error responses, security headers (CSP/CSRF/X-Frame-Options), body-size limiting, and rate limiting
  - Add router-composition note to `plans/orpc-v2-effect-migration.md` (Phase 1.7) for future direct-router merging in `every-plugin`
  - Standalone plugin dev servers now load declared `dependsOn` sibling plugins via `BOS_RUNTIME_CONFIG`, enabling `_plugins.*()` in `initialize` during local development

## 2.10.0

### Minor Changes

- 3be7608: Add PluginIdTag to Effect context for reliable plugin slug derivation in production

  - `every-plugin`: Exports `PluginIdTag` (`Context.Tag<string>`) and provides it via `Effect.provideService` during plugin initialization
  - `api`: Replaces `getMigrationSlug(import.meta.dirname)` with `yield* PluginIdTag` so the slug resolves correctly in Module Federation remotes
  - `everything-dev`: Adds `pg` to dependencies and `neverBundle` to fix module resolution in child projects running `bos db doctor`/`repair`

## 2.9.6

### Patch Changes

- 6bc36f0: Overhaul CI/CD workflow architecture: switch from `workflow_run` triggers to `repository_dispatch` chain to eliminate skipped runs, sequence Deploy after Release+Docker to prevent stale Railway redeploys, gate Docker on actual npm publishes, move framework tests from Release to CI with path-based filtering, add Playwright browser caching, fix unsafe `git rebase -X theirs` in deploy/staging retries, and remove duplicate GitHub release creation from Deploy.

## 2.9.5

### Patch Changes

- d03dd58: Plugin initializations that fail are now evicted from the `Effect.cached` cache so the next `usePlugin` call retries instead of returning a permanently-cached failure. When `initialize` fails, the plugin scope is closed immediately, releasing scoped resources (DB pools, caches) that would otherwise leak until process exit. The router is now constructed once per plugin instance rather than on every `createClient` call.

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
