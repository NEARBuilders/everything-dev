# everything-dev

## 2.0.0-rc.2

### Minor Changes

- a3f6c55: Split the runtime image leg out of the deploy train

  - `bos deploy` gains `--image-digest` (or `BOS_IMAGE_DIGEST`): when set, the image build/push leg is skipped and the Railway deploy pins a thin `FROM <image>@<digest>` Dockerfile to the pre-pushed digest. Without a digest the behavior is unchanged — the image is built and pushed locally when docker is available.
  - The production Deploy workflow now runs two jobs, image first: an `image` job builds the `runtime` stage and pushes it to GHCR (sha-<short>, exact version tag, floating v<major> + `:latest` on stable — `:latest` held during prereleases) and outputs the captured digest; the `deploy` job passes `BOS_IMAGE`/`BOS_IMAGE_DIGEST` so the config/bundle publish only happens for a deploy whose image is already in the registry, and a failed image push no longer leaves a partially published deploy.
  - `staging.yml` and the consumer workflows are unchanged: `bos deploy` still builds and pushes the image itself when no digest is provided, and child repos (no Dockerfile) degrade exactly as before.

### Patch Changes

- a3f6c55: `everything-dev/ui/auth`'s published types collapsed to `any`: when the dts build ran while a workspace dependency's dist types (better-near-auth) were missing or unresolvable, rolldown-plugin-dts silently emitted `createAuthClient(options?): any`, poisoning `AuthClient`, `SessionData`, `Organization`, `Passkey`, and the session query types for every npm consumer (this shipped in 2.0.0-rc.1). The emitted declaration also referenced `RelayedTransactionT` without importing it. The everything-dev build now guards both ends: it fails fast when the workspace dependencies' dist types are missing (`pnpm --filter better-near-auth build` fixes it) and fails the build if the emitted `createAuthClient` return type collapses to `any`.
- a3f6c55: Three export subpaths shipped pointing at unpublished `./src/` files — `./fingerprint`, `./version-manifest-resolve`, and `./ui/version-check` — so every consumer outside the monorepo (notably child repos, whose scaffolded `ui/src/components/version-refresh-banner.tsx` imports `everything-dev/ui/version-check`) failed to resolve them at typecheck and runtime. All three now follow the canonical exports shape used by every other subpath: a `development` condition mapping to `src` plus dist fallbacks (`./dist/*.d.mts` / `.mjs` / `.cjs`). Release staging also now fails loudly when any export target still points at `./src/` after development conditions are stripped, instead of publishing a dangling path.

## 2.0.0-rc.1

### Patch Changes

- 45f8656: Scaffolded docs reference `bos.app.ts`, not `bos.config.json`. The init-scaffolded README/AGENTS/skill templates told users the runtime configuration lives in a root `bos.config.json` — but the scaffold generates (and tests assert) the authored `bos.app.ts` descriptor. Cosmetic doc sweep; legacy JSON configs in existing child repos still load.

## 2.0.0-rc.0

### Major Changes

- d57b8f4: Consolidated `bos deploy` — one command runs the full train, and `bos publish` is config-only (ADR 0020/0021).

  **`everything-dev` (breaking):**

  - `bos deploy` is the full train: preflight (config → auth guards → signing → storage/CDN credentials → registry reachability, all before any build) → staleness-checked build train → bundle upload to the R2-backed storage → FastKV publish with read-back confirmation → `runtime` image build pushed to GHCR by short-SHA and `latest` tags (image name: `ci.image` in `bos.config.json`, `BOS_IMAGE` env, or derived from `repository`) → pull-only Railway deploy pinned to the pushed digest via a generated thin `FROM <image>@sha256:<digest>` Dockerfile in `.bos/deploy/` (`RAILWAY_DOCKERFILE_PATH`). Missing legs (no `ci.image`, no docker, no `RAILWAY_TOKEN`) degrade gracefully with a notice — child repos get build+upload+publish only.
  - `bos publish` no longer builds or uploads — it re-publishes the current `bos.config.json` and confirms the read-back. The `--deploy` and `--packages` options are removed (`bos build --deploy` is gone too); use `bos deploy`.
  - `DeployResultSchema` replaces the required `redeployed` boolean with optional `image`/`service`; the deploy command's `railway redeploy` branch (which re-deployed the _old_ image) is deleted.
  - Storage-mode disclosure: the bundle upload response carries `storage: "s3" | "memory"`; `bos deploy` hard-fails when the receiving instance only has in-memory storage (bytes would be lost on restart).
  - Scaffolded children get `"deploy": "bos deploy"` and single-command deploy/staging workflow templates.

  **`api`:** `POST /api/storage/bundles` responses include `storage: "s3" | "memory"` reflecting the resolved bundle-storage backend.

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

- d57b8f4: Manifest composition replaces route-tree grafting as the composed-SSR model (plan 034, ADR 0007/0008). The host constructs the ENTIRE route graph from generated manifests (`manifest.gen.json` + `routeConfig.gen.ts` per ui source) through the core ui's `./compose` engine; `defineUiPlugin`, the `./tree` expose, `composeApp`/`graftCopy`, the v1 mount registry, the homegrown digest, and the dedicated `ui-ssr`/`plugin-ui-ssr` dev servers are deleted. `bos dev --ssr` now composes from source manifests in the host process (no extra servers or probes); `BOS_UI_COMPOSE` is gone. Client runtime config changes shape: `ui.compose` is now `{ digest, remotes: [{key, name, entry}], manifests }` and `ui.composeDigest` is removed. Plugin ui remotes consume shared deps with `import: false` (the core provides); mounts are registry v2 (`public`/`authenticated`/`admin` implemented, `org`/`team` declared) and root-level pathless layouts.
- d57b8f4: Plugin identity unified and shared dependencies specified once.

  **every-plugin**: new `every-plugin/identity` — one derivation for npm/remote/container names from the config layout key (`remoteName`, `containerName`, `identity`, `pluginLayoutKey`, `resolveDevPluginId`); `plugin.dev.ts` no longer carries `pluginId` (the dev server derives it from the workspace `package.json`, fixing the `dependsOn` sibling lookup). New `every-plugin/shared-deps-spec` — the canonical shared-dependency lists, criticality, and version resolution; unresolved versions now **fail the build loudly** (`SharedDependencyResolutionError`) instead of silently degrading to `*`/`latest` and disabling the strict-singleton guard; all four consumers (rspack, rsbuild, runtime mf-config, host pre-registration) derive from it. The `apps` plugin is renamed `registry` (dir, package `@everything-dev/registry-plugin`, config attachment key `plugins.registry`, `apiClient.registry.*`) — the attachment-key rename is a published-config break; land it with the bundle deploy.

  **everything-dev**: consumes both modules; scaffold (`_template`) stops emitting `pluginId`.

- d57b8f4: `bos plugin publish <key>` joins the atomic-deploy train — full parity with
  `bos deploy` scoped to one plugin: preflight (storage/CDN credentials +
  signing) fails fast before any build, then build → upload to the R2-backed
  storage → compose + pin the workspace's version manifest → config write-back
  → FastKV publish + read-back confirmation. Breaking: the image-native
  `applyPluginPublishUrl` path is deleted — a plugin publish ships real bytes
  to the storage origin; it requires the storage credentials (BOS_STORAGE_API_KEY
  or a bos login session) it previously skipped. Tenant UI overrides are
  pin-aware: the org node-config editor accepts and verifies a
  `pin: { manifest, integrity }` (the "fetch bundle" flow copies the pin from
  the deployed config), and the host verifies tenant override entries at their
  pin-derived hashed URLs instead of the fixed entry name. The dormant
  local-production config helper (`prepareLocalProductionConfig`, ADR 0009) is
  deleted.
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
- 9191ab3: pnpm workspace, node runtime — the v2 clean break (ADR 0026)

  - `bos init` emits pnpm-native children: `pnpm-workspace.yaml` (synthesized
    globs + merged catalog), a `packageManager` field, pnpm filters in every
    generated script, and pnpm prose in AGENTS.md/onboarding. The child's
    authored config is always the generated `bos.app.ts` (never a copied
    `bos.config.json`, never bunfig). Installs run `pnpm install --ignore-scripts`;
    stray `bun.lock`/`pnpm-lock.yaml` are removed so installs re-resolve.
  - The orchestrator spawns node/pnpm: dev services launch through `pnpm run dev`
    (host via `NODE_OPTIONS=--conditions=development`; plugins through
    `every-plugin dev`'s tsx path), the bun-flag chaining is gone.
  - Workspace-root discovery reads `pnpm-workspace.yaml` first (package.json
    `workspaces` stays the pre-v2 fallback) — fixes the prerequisite train
    silently no-oping after the catalog moved.
  - Non-framework `workspace:` deps normalize to `catalog:` in generated
    children (pnpm does not link catalog-indirect workspace members).
  - Child CI templates are pnpm/node (`pnpm/action-setup` + node 24, `pnpm audit`
    with `AUDIT_STRICT` gating, stray-bun guard).

### Minor Changes

- d57b8f4: Atomic deploys phase A (tickets 01-02 of .scratch/atomic-deploys): builds emit content-hashed entrypoints (`remoteEntry.[contenthash].js`, `remoteEntry.server.[contenthash].js`), immutable hashed `mf-manifest.json` and `style.css` copies, and a per-dist `build-report.json` for the deploy leg — fixed-name entry aliases are fully retired (hard break; dev servers keep the fixed dev names as the dev serving contract). Bundle cache classification now treats any content-hashed name as immutable regardless of base name. New `every-plugin/version-manifest` export defines the immutable per-deploy `WorkspaceVersionManifest` document, and config slots accept a `manifest` pointer (versioned manifest filename) — the deploy unit for atomic, additive deploys.
- d57b8f4: Atomic deploys phase A completed (tickets 03-04 of .scratch/atomic-deploys): the deploy leg now composes an immutable per-workspace version manifest from the server-computed SRI map, uploads it additively at `versions/<id>.json`, and pins slots by manifest pointer (`manifest` + the manifest's SRI) — a dist that cannot pin (no build report / no entry SRI) aborts the train instead of writing fallback pointer entries (hard break). Upload transport hardened: status-0 retries on fresh connections (`connection: close`, 5 attempts, backoff+jitter), retryable statuses capped at 3. Resolution derives entry-level fields (`entryUrl`, hashed browser-manifest `entry`, entry SRI, `ssrEntryUrl`) from the version manifest behind a content-addressed per-pin cache; consumers (host html/head/ui-compose/plugins SSR loads/federation SSR entries/mf type inference, hydrate manifest registration) prefer the derived hashed URLs with fixed-name fallbacks only for dev and local slots.
- d57b8f4: Fix auth plugin remote load by resolving its MF container name from its `plugin.manifest.json` (mirrors the resolution `plugins.*` already use). Without this, in remote mode the host registered the auth remote under the slot key `"auth"` while the container's self-name was `everything-dev_auth-plugin`, causing `@module-federation/node`'s chunk-URL fallback to silently return empty chunks and throwing `ModuleFederationError: undefined is not an object (evaluating '__webpack_modules__[e].call')` — the only plugin to fail. Bos configs can set an explicit `app.auth.name` to pin the remote name.
- 95261fe: Finish ADR 0023: the generated bootstrap stubs now read two authored override exports from `ui/src/app.ts` — `appLocale` (SSR locale negotiation: locales, defaultLocale, cookieName) and `apiConnectionError` (localized API connection-failure toast copy). Default error/pending/not-found components are set inside the authored `createRouter` factory in `ui/src/router.tsx`. Hard break to v2: children that hand-customized `hydrate.tsx` / `router.server.tsx` get them backed up and deleted by `bos sync`/`bos upgrade`, and must port the customizations into the authored seams (the sync output prints the port guide; originals land in `.bos/sync-backup/<timestamp>/`).
- 1d0bfff: Authored `bos.app.ts` is now the canonical config form. `findConfigPath` prefers `bos.app.ts` over a legacy `bos.config.json` when both coexist — a generated write-back file can no longer shadow the authored descriptor.

  Publish fixes for TS-form projects:

  - Config-only `bos publish` no longer crashes with ENOENT when no `bos.config.json` exists. It resolves the authored config via the resolution session and merges authored hand-edits over the currently published FastKV config (child-wins), so live bundle URLs and integrity carry over while authored edits win. Removing a slot from the authored config still requires `bos deploy`, which regenerates the payload from scratch. When the registry read fails (unreachable — as opposed to a genuine first publish), config-only publish aborts instead of publishing a URL-less payload that would wipe live bundle URLs.
  - The deploy train no longer writes the URL-injected config back to the authoring root for TS-form projects — pipeline state stays in FastKV. Legacy JSON-form children keep the existing `bos.config.json` write-back.
  - The FastKV registry key remains `apps/<account>/<gateway>/bos.config.json` (unchanged wire format).

  Config-mutating commands (`bos plugin add`/`remove`, `bos upgrade`, `bos registry use`) now write the authored form: TS-form projects are edited in place via the descriptor serializer (authored leaf + delta, no inherited values baked in); JSON-form children unchanged, except `plugin remove` of a parent-inherited plugin now writes a null-sentinel override (the descriptor form cannot express removal, so TS-form projects get explicit guidance instead). Swept hardcoded `bos.config.json` paths to the form-aware helpers (`bos status`, `bos mf check`, shared-deps, bundle-fetch identity) and neutralized "No bos.config.json found" error wording (shared `MISSING_CONFIG_MESSAGE`).

- d57b8f4: `bos.app.ts` is operative: the config loader accepts the authored TS descriptor alongside `bos.config.json` (JSON preferred when both coexist, so the parent's pipeline-written state is untouched; a TS-only child is the new child form). The authored descriptor materializes into the same `BosConfigInput` the pipeline consumes — import-extends (an imported parent descriptor is an inlined parent) and `bos://`/file extends refs flow into the existing JSON extends chain unchanged, so publish/sync canonicalize the resolved config to JSON for FastKV with identical resolution. `bos init` scaffolds children with the TS config form by default: the personalized config materializes into an authored `bos.app.ts` and the JSON copy is removed; `bos sync` reads TS-form children through the same materialization and never injects the parent's JSON into them. Golden-fixture coverage extended: the materialization round-trip (descriptor → config input → descriptor) is proven lossless outside `extends`/`name`, and a TS-authored child is proven to resolve identically to the equivalent JSON child. ADR 0005 status advances to Accepted (phase 1). Closes #188.
- d57b8f4: `bos dev` reads the `bos.app.ts`/`bos.dev.ts` pair: development opens pick up a root `bos.dev.ts` overlay (a `Partial<AppDescriptor>`, child-wins, never published); malformed overlays fail loudly naming the file. CLI internals: plugin.ts decomposed into per-command modules, the dev/start result carries session data (pendingSession channel deleted), `keyPublish` prompts via the shell (additive `removeOldKeys` input, piped-stdin defaults to Y as before), and the init flow fetches the parent config once.
- d57b8f4: `bos login` — sign in with your NEAR account through the hosted site via the OAuth 2.0 Device Flow (RFC 8628), the same flow the site's QR pairing uses: the CLI requests a device code, you approve at `/login/device` in any browser (same machine or not — it works over SSH and headless), and the CLI mints its credential from the approved session. `--key` exports a scoped FastKV publish key to `~/.near-credentials`; the gasless delegate key is approved in the browser on the same page (wallet signs the `addKey`). `bos logout` revokes the credential. `bos publish --wallet` publishes gaslessly via a NEP-366 delegate action through the platform relayer. New `publish.auth` config surface (`session` | `key` | `custody`). The auth server's device-authorization plugin now serves the flow at `/login/device` (moved from `/device` — nothing had shipped against the old path) and accepts any non-empty `client_id` (public-client device flow — user approval is the trust boundary; the code↔client binding is still enforced at the token endpoint). The site's `/login` now preserves full redirect targets including query strings.
- d57b8f4: `bos rollback`: republish an earlier config snapshot from the registry's publish history. `fetchConfigHistory` reads the FastData exact-key history (newest-first, limit 1–200). Before republishing, every pinned slot's version manifest must still serve and match its SRI — a gone or mismatched byte refuses with a per-slot report and `--force` cannot override it (force only admits pre-Phase-A snapshots with no verifiable pins, which are warned loudly). The target is stamped `rolledBackFrom` (additive config field) so publish dedup treats the rollback as distinct state, and an identical-to-live target short-circuits. No flags → interactive selection over the history listing; `--previous` and `--version <block-height>` for scripts.
- d57b8f4: Add a `bos typecheck` command that runs TypeScript type checking across all local workspaces (host, ui, api, auth, and every plugin with a `tsconfig.json`), streaming errors inline and failing with a non-zero exit if any workspace fails. Root `bun run typecheck` now delegates to it.

  - New `bos typecheck [packages]` aggregates pass/fail across all configured local workspaces instead of stopping at the first error.
  - Framework source hardened for strict consumer configs (`noUncheckedIndexedAccess`): safe non-null assertions in `contract.ts`, `fastkv.ts`, and `api-contract.ts`.
  - `plugins/apps` tsconfig aligned with the plugin template (`types: ["node"]`, DOM lib) so its typecheck passes.

- 96928b0: Release workflow adopts the canonical changesets flow: `release.yml` now runs on every push to `main` — pending changesets open or update the `chore: version packages` PR automatically, and merging it publishes the packages to npm (under the `rc` dist-tag while `.changeset/pre.json` pre mode is active) and creates GitHub Releases. The manual `workflow_dispatch` trigger remains for retries; the `force_release` and `ref` inputs are gone. Publishing moved from inline workflow steps into `scripts/publish-release-packages.ts` (`pnpm run release`), porting the build → stage → publish → release logic verbatim, including the already-published/existing-release skip guards.
- ## d57b8f4: Child bundle storage (ADR 0020): `POST /api/storage/bundles` uploads workspace dists to the platform storage (session or API-key auth, account-pinned, path allowlist, traversal rejection, 64 MB ceiling, server-side SRI) backed by an S3-compatible client (R2 in production via `BOS_STORAGE_*`, in-memory fallback). `bos publish` gains the CDN deploy path: with the CDN origin resolved (env or the base's inherited bundle URLs), dists upload in batched requests and every bundle URL (root's own included) points at the CDN origin with integrity fields; the credential rides the `bos login` session or `BOS_STORAGE_API_KEY`.
- d57b8f4: `bos init` delivers a child-sized docker-compose (api + api-test Postgres,
  no auth databases — auth is inherited via extends) and only when the api or
  host workspace is overridden locally.
- d57b8f4: `bos init` now scaffolds the agent workflow layer into child repos: `.agents/skills/` (the mattpocock workflow skills verbatim — grill → spec → tickets → implement/tdd → code-review — plus the repo-authored `everything-dev-app` orientation glue skill), `docs/agents/` tracker/triage/domain conventions, and `skills-lock.json` provenance. All of it is framework-owned under `bos sync` (updates with upstream drift, child-added skills left untouched). The child `AGENTS.md`, `skill.md`, and `llms.txt` surface the workflow skills so a fresh agent session discovers them unprompted.

  Also fixes `bos init` crashing on TS-form children (`bos.app.ts`): shared-deps sync and config resolution no longer require a `bos.config.json` that the authored-config conversion intentionally removes — the init flow passes the converted config explicitly and tolerates resolution before the first `bun install`.

- d57b8f4: Add shared internationalization support for CityNode with English, Spanish, French, and Chinese catalogs.

  - Detect and persist a global locale across the main and auth UI bundles.
  - Localize login, public navigation, landing, discovery, and community application flows.
  - Save signed-in language preferences in account settings.
  - Format public dates and numbers with the active locale and document the translation workflow.

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

- d57b8f4: `bos init` scaffolds a commented `bos.app.ts` and a `bos.dev.ts` dev-overlay
  starter next to it.
- f9d2dce: Per-remote failure isolation in composition (ADR 0024 §5): a plugin source that cannot produce a usable manifest — fetch failure with no last-good snapshot, unparsable content, or an identity mismatch with its config key — now drops itself with a warning and the healthy subset composes, instead of the whole composition failing (SSR 500) or all remotes degrading to the core-only tree. The digest and the client payload are computed over the healthy set in canonical (sorted) order, so server-side drops hydrate cleanly; a client-side drop degrades to client-render. The core source failing stays a loud failure.
- d57b8f4: Migrations serialize on a journal-scoped Postgres advisory transaction lock (ADR 0019): the dev double-boot (plugin dev-server + the host's in-process load), parallel test files, and overlapping production replicas converge on the journal instead of colliding in pg_catalog — a blocked migrator waits (bounded by `lock_timeout`) and then applies nothing the winner committed. SAVEPOINT-based duplicate-DDL tolerance stays as defense-in-depth for non-participants (`drizzle-kit`), the journal-init retry stage is absorbed into the locked transaction, and the regression pre-migration mirror takes the same lock. Fixes the flaky dev-stack plugin-boot failure that served stacks without a failed plugin.
- d57b8f4: Config pipeline is Effect-native (ADR 0009 §6): `loadResolvedConfig`, `resolveRuntimePlugins`, and `buildRuntimeConfig` run as `Effect.fn` cores with a typed error channel — `Schema.TaggedError` classes (`ConfigLoadError`, `CircularExtendsError`, `ConfigNotLoadedError`, `ConfigNotfoundError`, `ConfigExtendsError`, `ArtifactGenError`) replace thrown `Error` strings, all with identical messages and `instanceof Error`, so no caller changes. Exported signatures stay Promise-based (bridges); the `*Effect` exports are available for Effect callers. `code-artifacts.ts` gains the same treatment (`generateCodeArtifactsEffect`). Behavior-preserving: resolution outputs, warning discipline, and cache side effects are pinned by the existing suite.
- d57b8f4: Serve a client compose payload on the no-SSR client shell so CSR deployments compose plugin UI routes. Previously `runtimeConfig.ui.compose` was only embedded when SSR rendered the page, so default `bos dev` (no `--ssr`) and any CSR-only runtime (no `ui.ssr`) fell back to the bundled core-only route tree — plugin routes like the auth plugin's `/login` were absent and dynamic core routes (`_public/$accountId`) swallowed the path instead. The shell now embeds the same manifests + digest + plugin web entries the SSR path uses (built without touching MF loaders); when no plugin declares a ui, or the payload cannot be built (warn-logged), the shell keeps the bundled core-only tree.
- d57b8f4: DB driver honors libpq `sslmode` from the connection string — `require`/`prefer`/`allow` encrypt without certificate verification (managed providers hand out unverifiable certs), `verify-ca`/`verify-full` verify, bare non-local URLs keep verification on, and `DB_SSL_REJECT_UNAUTHORIZED` still overrides. Fixes production deploys that began failing the moment TLS verification was flipped on by default.
- d57b8f4: Deploy origin safety: `bos.config.json` gains an authored `cdn.origin` (inherited via extends) that `bos deploy` requires before uploading — the dev-resolved `host.url` is never promoted to a published bundle URL again, a `bos login` session pinned to a local site is a hard error, and the upload origin is probed (`/.well-known/mcp.json`) in preflight so a wrong-port target fails before the build train. Config-only publishes (`bos publish`) require no origins.
- d57b8f4: Add mobile-to-desktop sign-in and passkey-based NEAR wallets:

  - RFC 8628 device authorization flow (official Better Auth `deviceAuthorization` plugin, first-party session path with a configurable `deviceLink.clientId` variable — default `everything-dev`, citynode.app overrides with `citynode-web`), a `/device-link/claim` endpoint that exchanges the polled session token for an httpOnly cookie, and auth-plugin UI pages for QR pairing (`/login` "sign in with phone"), `/device` code verification, and `/device/approve` approval.
  - Passkey sign-in through the official `@better-auth/passkey` plugin: session-less first-time registration (generated-email user via `registration.resolveUser`) with a sign-in orchestration that creates the credential on first use, plus "sign in with passkey" buttons on `/login` and `/onboard`.
  - NEP-616 deterministic (`0s…`) passkey wallet support: `/near/link-passkey-wallet` verifies a NEP-413 assertion against the user's stored passkey credentials server-side (challenge binding, user-verification enforced, nonce replay protection) and links the derived account — no public key crosses the wire, no on-chain lookup needed. `/near/verify` also accepts passkey wallet-contract accounts.
  - `siwnClient` gains a `wallets` option for registering near-connect sandbox wallet executors.
  - Organization onboarding stations: capped, expiring onboarding codes (named after an event) with QR pairing, live redemption status, and event-team membership. Station codes always grant plain membership — revocation now rejects prior redeemers too, and the plaintext code is displayed once at creation.

- f151e1b: Differential bundle uploads: each deploy's version manifest now records the dist's full per-file SRI map (`files`), the next deploy hashes its local dist against it and re-uploads only new or changed files. Previous pins resolve from a new `.bos/deploy-state.json` pointer (written after every confirmed publish) with the published config as fallback; any unusable previous manifest degrades to a full upload. `--full-upload` / `BOS_FULL_UPLOAD=1` bypasses the diff.
- d57b8f4: Adopt the Effect DevTools toolchain: native TypeScript 7 (`@effect/tsgo`) with the Effect language-service plugin, and Oxlint with type-aware Effect rules.

  TypeScript peer/dev ranges are narrowed to `^7.0.2` (no more `^5` support): `every-plugin`, `better-near-auth`, and `@everything-dev/auth-plugin` now require TypeScript 7, and `everything-dev` moves its devDependency to `^7.0.2`. Builds are unaffected (rspack/rsbuild transpile); typechecks and the editor language service run on the patched TS 7 native compiler.

  TS 7 compatibility fixes: the test-plugin fixture consumes the built `every-plugin` declarations, and a new root `tsconfig.base.json` consolidates shared compiler options across parent-owned workspace tsconfigs (scaffolded `ui/`/`api/`/`plugins/*` tsconfigs stay self-contained since they are copied verbatim into child projects).

  Contract declarations move into the plugin build entirely: `every-plugin build`/`deploy`/`dev` regenerate `types/contract.d.ts` from `src/contract.ts` via the patched TypeScript 7 binary whenever it is stale (rspack watch keeps dev types fresh automatically), and `EmitPluginManifest` embeds the fresh file with a verified sha256. The per-workspace `tsconfig.contract.json` files are removed — `bos sync` migrates child projects, and `every-plugin types` regenerates manually. `bos typecheck` now regenerates client-stub types itself before type-checking, so the root `types:gen` script is gone. Remote plugin-manifest fetches during `types gen` retry on transient network failures.

- d57b8f4: Complete folder-form plugin UI sources: a `ui/` directory with route files but no own `package.json` is now built entirely by the plugin's `every-plugin dev`/`build` (a generated rsbuild config under `.every-plugin/`), replacing the separate plugin-ui workspace.

  - Dev orchestrator passes `BOS_UI_PORT` to the plugin dev process — including the auth app slot, whose `plugin:auth` descriptor is never spawned — so the plugin ui dev server always listens on the port the runtime config advertises (previously it auto-picked a port, breaking client-side compose of plugin routes)
  - Folder-form ui builds output to the ui source root's `dist/` (web + `ssr/` containers), matching what the host's local SSR container server and manifest reads expect
  - Generated rsbuild config now carries a `deployLabel`
  - `bos dev` warns and suggests a single restart when its build step finds the everything-dev dist stale — the running CLI keeps the previously imported build, so orchestrator changes are one session behind without it
  - New `csr` browser-regression mode (`regression:start:csr` / `test:regression:browser:csr`): the dev stack without `--ssr`, running a focused spec set that pins client-side manifest composition of plugin routes (including a no-CSP-violation assertion) — the default dev path was previously untested by the regression suite

- d57b8f4: Foreign-namespace bundle resilience for the child tier (ADR 0011 amendment): the host's `/bundles/*` route falls through to a proxy + stale-if-error disk cache for namespaces mapped from the runtime config's slot URLs — a base-origin outage now degrades to serving last-known-good bytes (`x-bundle-cache: stale`) instead of a hard 502. The CLI fetch adapter gains the same cache for boot-time outbound fetches (one cache root, two entrances, `BOS_BUNDLE_CACHE_DIR`, default `.bos/bundle-cache` — deliberately separate from `BOS_BUNDLE_DIR`: cached bytes are a resilience artifact, never a deployment). Never enabled for plain dev sessions; cached bytes serve only when the origin fails, so normal operation keeps serving fresh.
- d57b8f4: Framework UI files children receive as byte-identical copies move into the `everything-dev` package as ui subpaths — hydrate (client bootstrap), router-client (client router factory), router-server (SSR router module), entry (web entry runner), and router-error (the generic error boundary). Child copies shrink to thin wiring stubs that inject only the app's generated artifacts (`routeTree.gen`, `routeConfig.gen`, `styles.css`) and join the framework-owned sync set. The framework router/hydrate modules import the package's own api/auth/runtime/manifest surfaces; compose payload digest parity is unchanged (the hydrate suite ports to the package and keeps the digest-mismatch fallback coverage). `RouterContextWithApi` gains the optional `authClient` the routers already threaded. Closes #186.
- d57b8f4: Hermetic boot for image-native runtimes (ADR 0011 amendment — the image consumes what it stages): a self-contained runtime resolves its own-namespace bundle URLs (`https://<domain>/bundles/<account>/<gateway>/…`) from `BOS_BUNDLE_DIR` on disk instead of round-tripping through its own public origin, so a cold boot no longer depends on the gateway, DNS, or the host being up. Registry-tier children are unaffected — remotes still load from their published URLs. `BOS_BUNDLE_DIR`-less environments see zero behavior change.

  Also fixes the production crash-loop class this exposed: port allocation no longer reserves ports for remote-source services (they spawn nothing locally), a stale PID-registry claim (PID reuse across container restarts) can no longer wedge a pinned port — claims record the process generation and are pruned when it no longer matches — and Docker healthcheck start-periods no longer kill a cold boot mid-startup. `bos start` reports `InfraError`/`DevStepError` failures instead of escaping them as unhandled rejections.

- d57b8f4: Image-native artifacts: the runtime image stages every workspace's dists and the host serves them same-origin from `/bundles/<account>/<gateway>/<workspace>/…` (`BOS_BUNDLE_DIR`). The publish writes deterministic bundle URLs — no CLI session, no uploads, no CDN provider. Deploy workflow: publish (config to FastKV) → `railway up` (image build ships the artifacts) → `bos mf check` gate. Supersedes the DB-backed bundle storage pre-release (ADR 0011).
- d57b8f4: `bos init` prunes unreferenced ui sources for ui-override children. After copying the parent's ui workspace, a static import graph seeded from framework-owned files and the copied routes walks `@/` and relative imports — named imports through the components barrel keep only the named exports' files; a namespace import keeps everything it exports. Unreachable lib/component/provider files are deleted (their tests go with them, orphaned tests whose subject doesn't exist get cleaned up, empty directories collapse, and the components barrel loses the dead export statements). Framework-owned files, generated types, and route files are never pruned. The init snapshot records the post-prune state, so `bos sync` never re-adds pruned files. On the citynode template this removes the whole app-detail family, four unused shadcn primitives, and dead lib files for every fresh child.
- d57b8f4: Add `--env staging` flag to `bos key generate`.

  - `bos key generate --env staging` resolves the staging account from `bos.config.json`'s `staging.account` field (falling back to the top-level `account` if unset), matching the behavior of `bos publish --env staging`.
  - The network is inferred from the resolved account (`.testnet` suffix → testnet, else mainnet), same as before.
  - CLI output now suggests the correct GitHub Actions secret name: `NEAR_TESTNET_PRIVATE_KEY` for staging, `NEAR_PRIVATE_KEY` for production.
  - The `KeyPublishResult` now includes an `env` field indicating which environment the key was generated for.

- c520871: Deepen i18n: locale negotiation from `citynode_locale` cookie + `Accept-Language` (with q-values) during SSR, `Vary: Cookie, Accept-Language` on localized responses, request-scoped locale in router context, a shared locale selection across the main UI and auth bundle runtimes, and localized router-error/API-connection/tenant-validation copy.
- f9d2dce: Manifest contract v2 (ADR 0024): route records adopt the TanStack virtual-file-routes vocabulary — `type: "route" | "layout" | "index"` replaces the `isLayout`/`isIndex` booleans — and the manifest version is enforced at every load: the host's manifest loads and the client's compose-payload parse reject a skewed major with one diagnostic (a version-skewed payload degrades to the core-only tree instead of silently mis-constructing). The folder-form ui's composition key now derives solely from the `plugins/<key>` layout — a non-derivable key fails the build loudly instead of silently falling back to the container name (the drift that mis-keyed manifests). Mount registry version bumps to 5, invalidating all compose digests once.
- d57b8f4: `bos publish` signs FastKV registry transactions in-process via near-kit.

  - Replaces the near-cli-rs shell-out: the publish transaction is built and signed with `near-kit` directly (no external binary, no curl|sh installer in CI, no key passed through argv).
  - Key resolution: explicit key or `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` env, falling back to the near-cli-rs credentials file at `~/.near-credentials/<network>/<account>.json`; when neither exists on an interactive terminal, signing falls back to the near-cli-rs OS keychain (`sign-with-keychain`) so existing local keys keep working; actionable error when nothing is available.
  - Real transaction hashes come from the RPC outcome instead of regex-parsing CLI output. The transaction is submitted with `waitUntil: "NONE"`: FastKV writes are action-indexed (the namespace contract need not exist or execute — a `CodeDoesNotExist` execution outcome is expected), so publish succeeds when the indexer reflects the write, verified by the confirmation loop. Submission-level failures (invalid signature, exhausted allowance) still abort with actionable errors.
  - Publishes are skipped when FastKV already holds an identical config (`isConfigAlreadyPublished`), saving allowance and the confirmation wait.
  - `near-cli.ts` is slimmed to key management (`bos key generate`); CI workflows drop the NEAR CLI install steps.

- d57b8f4: No-watch regression stacks: `BOS_NO_WATCH=1` makes every local service build once and serve the built output instead of running rspack/rsbuild watchers — the regression suite needs no hot reload, and the watchers were the stack's heaviest processes (freezing shared CI runners under their accumulated footprint ~26 tests in). Plugin API services run a one-shot `rspack build` and serve `dist` statically; folder-form ui sources build once and serve the ui source root's `dist` on `BOS_UI_PORT`; the core ui gains a `dev:built` script (`rsbuild build && rsbuild preview`). Local `bos dev` stays watch-mode. The CI regression suite also splits into two parallel jobs (SSR + CSR), each with its own 20-minute budget and a resource watchdog logging memory/top processes to the failure artifacts.
- d57b8f4: One row per plugin in the `bos dev` service table: `plugin-ui:*` companion rows merge into their parent as an inline `· ui :<port>` annotation (the `auth` app slot shows as one PLUGINS row, e.g. `AUTH (local) running :3002 · ui :3011`), SERVICES lists only host/api/ui, and a merged row counts as ready only when both its api and ui surfaces are ready. Auth-mirror detection now exists in exactly one shared helper (`isAuthMirrorPluginEntry`) — the inline copies in the infra planner, DAG, and api contract bridge are deleted.
- d57b8f4: Single-ceremony passkey sign-up with a linked Passkey Wallet:

  - A passkey registration begun without a session now ends signed in, with the Passkey Wallet derived from the new credential linked as the member's primary NEAR account — one biometric prompt. It applies only to a user created by that registration who owns exactly that credential; "add a passkey" while signed in never mints a session or changes the primary NEAR account. The verify-registration response carries `passkeyWallet` (`linked` or `unavailable`).
  - Registration asks for a discoverable, user-verified ES256 or EdDSA credential; registrations and sign-ins without user verification, or with a key that cannot derive a Passkey Wallet, are refused (`PASSKEY_UNSUPPORTED_AUTHENTICATOR` / `PASSKEY_USER_VERIFICATION_REQUIRED`).
  - The passkey plugin accepts every configured Gateway Origin of the runtime's network (`passkey.gatewayOrigins.{mainnet,testnet}`), with the rpID unchanged. The network comes from the runtime account.
  - better-near-auth: Passkey Wallet linking is one operation (`linkPasskeyWalletFromCredential`) shared by `/near/link-passkey-wallet` and the sign-up hook. Linking uses the new `passkeyWalletNetwork` option instead of a hard-coded mainnet; a network with no passkey wallet factory skips linking and reports `PASSKEY_WALLET_UNAVAILABLE`. `getPasskeyWalletFactory` and `isPasskeyWalletAvailable` are exported.
  - everything-dev: `signInWithPasskey` no longer falls through to registration; use the new `createAccountWithPasskey` to create an account. `isPasskeyAutofillAvailable` and `isUnsupportedAuthenticatorError` support browser autofill and unsupported-authenticator messaging.
  - Users created by abandoned passkey registrations (older than an hour, with no passkey, NEAR account, account, session or phone number) are swept every 15 minutes, with their personal organization.
  - The login page offers passkey autofill and points to Sign in with phone or a NEAR wallet when no passkey is found; the onboarding page offers "Create account" and "I already have an account", notes when no passkey wallet exists on the network, and offers an optional display name after joining.

- d57b8f4: Sunset the DB bundle flow and Zephyr (plan 043 Phase B, ADR 0011) — the image is the deployment.

  - Delete the platform bundle storage: the `bundle_objects` table (migration squashed pre-release), the `BundleStorage` service, `POST /api/storage/bundles`, the oRPC `serveBundle` route, and its host bodyLimit scoping. `/bundles/*` is served from the runtime image's filesystem via `BOS_BUNDLE_DIR` (Phase A) — with it unset, bundle URLs no longer fall through to any storage route.
  - Remove Zephyr entirely: the `withPluginDeploy`/`withZephyr` attach points, `BOS_CDN_PROVIDER`/`DEPLOY`/`FORCE_COLOR` env wiring, deploy-output parsing (`[BOS_DEPLOY]` lines, `ZE…` errors, retry backoff), the `deploy.cdn` config field, the `--cdn` flag, and zephyr build plugins from the catalog and all workspaces. `bos publish --deploy` unconditionally writes deterministic `https://<domain>/bundles/<account>/<gateway>/<workspace>/` URLs.
  - `bos plugin publish <key>` now builds the plugin and writes its deterministic bundle URL (no deploy script, no integrity hash).
  - Workspace `deploy` scripts are removed — `bos build --deploy` is the only deploy path.

- d57b8f4: Consolidate the migration runner and DB driver into `everything-dev/db` (advisor plan 008).

  **Root-cause fix for the boot race** (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"` on `drizzle.__drizzle_migrations` when plugins booted concurrently against one shared database): `ensureMigrationTable`'s retry used `Effect.retry(..., until: isRetryableMigrationError)` — in Effect, `until` means _stop_ retrying when the predicate is true, so the race error the retry was built to absorb got zero retries (verified: 1 attempt with `until`, 4 with `while`). The shared runner now uses `while: isRetryableMigrationError`. `plugins/auth` had no retry at all and now inherits the shared one.

  **Shared runner** (`everything-dev/db`): `runMigrations(db, migrations, opts) => Effect<MigrationReport, DatabaseError>` with SAVEPOINT/ROLLBACK/RELEASE duplicate-DDL tolerance (fixes the proposals/votes bare-`continue` 25P02 aborted-transaction bug — the fix previously lived only in api and never propagated), retryable-SQLSTATE journal-init backoff, hash-tracked idempotence, and the duplicate-table preflight. `detectDrift`/`loadMigrations`/`loadMigrationsFromDisk` move with it; `loadMigrations` takes the bundler's virtual-module loader as an option so the shared package never names `virtual:drizzle-migrations.sql`.

  **Shared driver** (`everything-dev/db`): `createDatabaseDriver(url, schema, namespace?)` — engine by URL scheme (`pglite:`/`:memory:` → PGlite, else postgres), protocol-level `search_path`, **one-time** `CREATE SCHEMA` via `pool.connect()` (replaces votes/proposals' per-connection `on("connect")` handler that re-raced `CREATE SCHEMA IF NOT EXISTS` on every connection), env-driven pool config (`DB_POOL_MAX` etc.), idempotent close (drops auth's `pool.end()` stack-trace noise). Plus `pluginSchemaName(pluginId)` and a single shared `DatabaseError`.

  **Workspaces**: api/votes/proposals/auth `db/migrate.ts` and `db/index.ts` become thin sync-propagated adapters (< 40 lines; `bos sync` copies api's canonical copies verbatim into plugins). `plugins/_template` aligns fully to the standard flow: `migrator.ts` deleted (renamed to `migrate.ts`), canonical layer adopted, journal standardized to `drizzle.__drizzle_migrations` (pre-existing tables are auto-recorded by the preflight; the old in-schema `drizzle_migrations` table is frozen, matching 017/D6), and the `TemplateDatabase` alias is dropped. `adoptPublicTables` is deliberately **not** ported: it was a one-time boot-time `ALTER TABLE ... SET SCHEMA` relocation for pre-schema-isolation databases (live dev DB has zero `public` tables); legacy adoption stays with the fail-closed `detectDrift`/`bos db doctor` path, never boot-time magic.

  **Drivers stay excluded from the bundle graph**: the shared driver dynamic-imports engines (`pg`, `@electric-sql/pglite`, `drizzle-orm/*`) via bare specifiers, and everything-dev's tsdown config adds them to `deps.neverBundle`. This matters beyond hygiene: tsdown's unbundle mode otherwise rewrites dynamic imports into relative paths into its vendored `dist/node_modules/` copies, which (a) defeats rspack's `externals: ["pg", "@electric-sql/pglite"]` (externals match bare requests only), dragging pglite's `pglite.wasm`/`pglite.data`/`initdb.wasm` binaries into the MF dev bundles where they fail to resolve or parse as JS, and (b) makes node resolve `drizzle-orm` from the vendored `dist/node_modules/drizzle-orm` (nearest node_modules wins) whose copied layout breaks ESM resolution in the host process. Every workspace with a database already declares `@electric-sql/pglite` + `drizzle-orm` as its own dependencies, so bare runtime imports resolve everywhere — dev, prod MF bundles (via rspack externals), and `bos init` scaffolds.

  Regression suite added at `packages/everything-dev/tests/unit/db-run-migrations.test.ts`: fresh-schema, partial-overlap savepoint path (previously failed on proposals/votes with 25P02), duplicate-preflight journal recording, and a retry-semantics test pinning 3+ gen-runs on `23505`.

- d57b8f4: Plugin build framework consolidation: `EveryPluginComposedBuild` (the rspack stack — manifest emission + Module Federation + MF data-URI fix — in one composed plugin) and `createPluginBaseConfig()` replace per-workspace config boilerplate. New `every-plugin <dev|types|build|deploy>` CLI is the plugin package contract, absorbing the `build:types → tsc → rspack` chain; per-workspace scripts shrink to one-liners and `every-plugin-serve` bin is a single source import. Per-workspace `rspack.config.js` files are deleted — the CLI synthesizes the composed config (opt-in typed `build.config.ts` overrides). `deploy` builds the same as `build` — deploy URLs are written by `bos publish --deploy` (image-native), not by build hooks.
- 9191ab3: Node-based universal image (ADR 0026 ticket 04)

  - All five Dockerfile stages run `node:24-alpine` with pinned pnpm — no `oven/bun` base remains. The runtime `CMD` boots `bos start` on node (the start stack loads the host/api/plugins in-process through Module Federation; no child spawns on that path).
  - The dist-builder's workspace builds and the deploy train's build leg spawn `npm run build` (was `bun run`), and shared-deps catalog changes run `pnpm install`.
  - The every-plugin bin re-execs through tsx: `dev` carries the `development` condition; other commands run the built dist when present (fresh checkouts fall back to tsx + src for the bootstrap build).
  - The image prune script reads workspace globs from pnpm-workspace.yaml.

- c520871: Publish gate: before writing to the registry, every pinned slot's bytes are fetched from its production URL and checked against the pin's SRI. A publish whose pinned bytes are missing or mismatched is blocked instead of silently republishing broken pointers.
- d57b8f4: Purge the stale public surface: delete dead every-plugin exports (`PluginMetadataRegistry`, `LegacyPluginRuntimeConfig`, `PluginConstructor`, `ERROR_PATTERNS`, `getPluginSharedDependenciesVersionRange`, and the deprecated `createLocalPluginRuntime` / `createTestPluginRuntime` / `PluginMap` / `InferBindingsFromMap` testing helpers), restore the `bos upgrade` legacy dist-import rewrite to its original `everything-dev/dist/` → `everything-dev/` pattern (the mapping table had degenerated to an identity rewrite that could never fire), and replace the dead subaccount workflow in generated child AGENTS.md with the DAO-owned tenant flow.
- d57b8f4: Add `bos registry use` — compose sections from a published runtime into local `bos.config.json`.

  - `bos registry use <account>/<gateway> --sections app.ui,app.host,plugins.<key>` fetches the published config from FastKV and merges the selected sections (production URLs + integrity) into the local config, preserving everything else (account, domain, extends, development URLs).
  - `--dry-run` previews the merge; unknown sections fail with the list of composable sections available on the remote runtime.
  - After writing, run `bos types gen` to refresh generated types.
  - Ships with a new `registry` skill documenting the FastKV key layout, the namespace=signer law, and efficient registry read/write patterns.

- d57b8f4: Regression hardening for silent stack failure: plugin database pools now run with connection-level `lock_timeout` (10s, `DB_LOCK_TIMEOUT_MS`) and `idle_in_transaction_session_timeout` (30s, `DB_IDLE_TX_TIMEOUT_MS`) so a wedged lock wait or leaked transaction fails fast and names itself instead of hanging the pool — `ALTER DATABASE` never reaches connections that already exist. The auth handler gets a server-side deadline (`AUTH_TIMEOUT_MS`, default 30s) answering 504 instead of hanging the caller when Better Auth wedges, and the dev orchestrator now logs child exits that happen after a service reported ready — an OOM-killed or crashed service no longer disappears into total silence.
- d57b8f4: Atomic deploys tickets 05-06: (1) an aborted deploy train is now a structured `{status:"error"}` — upload failures no longer propagate raw out of `bos deploy`, and the train-level tracer (real `publishToFastKv` against a mock storage origin with batch-500 and socket-kill injections) proves the previously published version stays fully live: pointer untouched, pinned bytes byte-identical + SRI-verified, retention across a completed v2 switch. (2) The host gains a `RuntimeSnapshot` service — an atomic Ref over the UI/SSR base state (config + compose state + deployment fingerprint) with `get`/`swap`/`modify` (a throwing modify leaves the state untouched); the SSR fallback and static-asset request paths resolve per-request against the snapshot's current base config via the new `getBaseConfig` seam, so in-flight requests keep the state they captured (session-level blue/green) and ticket 07's swap coordinator can adopt a new published pointer without a restart.
- d57b8f4: Simplify the contributor getting-started flow to two commands: `bun install && bun run dev`. When the `bos dev` DB preflight finds local Postgres down (and every failure is an unreachable local service, `docker-compose.yml` exists, docker is reachable, and the stack is not test-mode), it now starts the compose services itself (`docker compose up -d --wait`) and re-probes once before failing. `.env` was already auto-created on first run — docs no longer tell you to copy it by hand, and `bos init`'s printed next steps drop the manual docker line.

  The dev bootstrap is also quieter: docker compose output is captured instead of drawn over the spinner (its tail is shown only when compose fails), the compose step renders as "Starting local Postgres..." on the spinner, and bootstrap-phase Effect INFO logs (e.g. `[env] ... updated` drift lines) no longer print to the console by default — pass `--log-level info` (or set `BOS_LOG_LEVEL` / `DEBUG=1`) to restore them. Warnings and errors always print.

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

- f5f1a5f: Add task-shaped skills `talk-to-the-app` (MCP/REST/RPC surfaces, API-key auth, discovery) and `add-a-route` (one complete contract → Effect handler → UI client → route → publish slice), and rework the public `/skill.md` into an entry-point router over the full 20-skill family with shared facts, pairings, and rules to work by. Every existing skill gains "the tasks you will actually be given" walkthroughs and grounded error-word → action tables.
- d57b8f4: `bos init` api-override children now receive a slim generic API shell (ping,
  db plumbing, middleware wiring) instead of the parent's full domain API.
- d57b8f4: Atomic deploys tickets 07-08: the host gains a `SnapshotCoordinator` (adopt the published FastKV pointer: derive via version manifests, pre-warm a fresh compose state, SRI-verify pinned entries, atomically swap the RuntimeSnapshot — any failure leaves the live snapshot untouched) and a `SnapshotWatch` supervised fiber replacing the setInterval integrity monitor (pointer poll → adopt on fingerprint change; per-tick entry SRI verification with re-adopt-then-alert on mismatch; production-only).
- d57b8f4: Atomic deploys watch hardening: the adopt transaction serializes through a semaphore (concurrent adopts cannot race the swap), the watch interval reads `BOS_SNAPSHOT_WATCH_INTERVAL_MS` (default 30s), extends-ref slots re-read their parent config from FastKV and verify against the parent's latest integrity (the upstream-republish detection the old monitor had, ported into the watch tick), the tick rides the host logger, and an unchanged-pointer verification failure alerts directly (re-adopting an identical pointer cannot heal serving-side corruption). The legacy setInterval integrity monitor is deleted — the watch fiber covers it.
- d57b8f4: SSR loader calls to plugin APIs now carry a per-call deadline (15s, opt-in at the `createPluginsClient` call site and enabled for the SSR render path). A wedged plugin endpoint rejects into the route's error boundary and closes the stream — the page degrades to an error instead of a never-ending suspended stream that hangs browsers and regression suites. The better-auth client surface is deliberately left unwrapped (its client objects carry non-call function-valued members).
- d57b8f4: `bos init` gains starter levels: `--level simple|advanced` (default `simple`).
  Simple scaffolds the public shell only; both levels exclude parent-only
  product routes. The chosen level persists in `bos.app.ts` and the sync
  snapshot.
- d57b8f4: Static docker-compose — infra auto-provisioning removed. The committed `docker-compose.yml` (api 5432, auth 5433, api-test 5434, auth-test 5435; project-scoped volumes) is now a plain template file that `bos init` copies like `Dockerfile`/`railway.toml` — nothing in the CLI generates or rewrites it, and sync treats it as hand-managed (skipped if locally modified). `.env.example`/`.env.test` still render from the runtime's secrets, but database URLs are mapped by convention (auth secret → auth db, every other `*_DATABASE_URL` → the shared api db; test twins on 5434/5435) instead of crawling resolved-config secrets with origin/port maps. `bos infra export` (CI plan) emits the same conventional services. Dev port state no longer persists postgres/redis ports — only explicit `devPorts` pins (ADR 0012); `bos dev` still picks a free port when the conventional one is busy. Existing projects keep their current docker-compose.yml untouched (it is never overwritten again); adopting the static file is opt-in and renames containers/volumes, so copy old volume data first (migration snippet in the file header).
- d57b8f4: Stream-driven ANSI TUI for `bos dev` — drops ink and React from the CLI package. The interactive view is now a pure render function over a single session-state holder with a hand-rolled alt-screen renderer (raw-stdin `q`/`l`/`ctrl+c` keys, terminal fully restored on exit); the piped/non-TTY fallback reuses the same render helpers and prints incrementally, deleting the duplicated streaming view. `ink`, `react`/`react-dom` (peer), `gradient-string`, and their type packages are removed from the manifest; the banner gradient is a small truecolor ramp.
- d57b8f4: Complete organization teams and wallet invitations across the auth plugin, API, and dashboard. Team workspaces now carry feature-area context through node mutation authorization, and organization owners can invite either an email address or a NEAR account, target a team, and manage wallet-aware pending invitations. Invitees can accept email or wallet invitations from the dashboard or claim link and land in the targeted workspace.
- d57b8f4: Tenant draft/url helpers move into the framework: `everything-dev/ui/tenant` is the single owner of the tenant origin construction (`buildTenantUrl`, `tenantLabel`, `isLocalHostname`), the node-config draft helpers (schema, diff, bundle entry resolution, sha384 integrity preflight), and the new `gatewayForAccount` — which derives the gateway for an owner account from the runtime config (the runtime's gateway when the account is on the runtime's network, null otherwise) instead of hardcoding per-network domains. The app-owned `ui/src/lib/tenant-url.ts` and `ui/src/lib/tenant-config-draft.ts` copies are deleted; call sites (tenant live site, node config, node directory, app detail runtime, staking poc) import from the package, so children stop receiving the copies via `bos init` and versions flow through the catalog / changeset release. Closes #184.
- d57b8f4: Generated infra now includes isolated test databases alongside dev databases. `docker-compose.yml` gains `postgres-api-test` (port 5434, `api_test_db`) and `postgres-auth-test` (port 5435, `auth_test_db`) services, and a committed `.env.test` maps every `*_DATABASE_URL` secret and `BETTER_AUTH_SECRET` to the test databases. Test suites load `.env.test` instead of `.env`, so regression runs (which drop and reseed plugin schemas) can never touch dev data. The infra planner also skips persisting port state when `NODE_ENV=test` or `BOS_TEST=1`, in addition to the existing `BOS_NO_PERSIST_PORTS=1`, preventing test runs from repinning dev ports.
- d57b8f4: Add a typed mount contract for ui plugin grafting: `defineUiPlugin({ name, mounts, tree })` declares a plugin's ui surface against the canonical `MountId` union (derived from `MOUNT_REGISTRY`, with `MOUNTS` exported). Root `_mount` declarations are validated at construction — typos and undeclared mounts throw with the offending route id and a closest-mount hint instead of silently never grafting; raw `routeTree` exports keep working via the derivation fallback. `MOUNT_REGISTRY_VERSION` bumped to `2026-09-19.1` (invalidates all compose digests).
- d57b8f4: Type `rpcBase` as a root-prefixed path at the runtime-config schema source (`z.templateLiteral`), drop the unchecked `/${string}` casts in the client factories, and pass DAO transaction args to near-kit without the `Record<string, never>` cast.
- f9d2dce: Invert router control: the app's authored router factory is now load-bearing. The client hydrator accepts `createRouter` and `createQueryClient` (framework factories remain the fallback), and the SSR router module mints each request's router through the same factory — so notFound/pending/error components, scroll behavior, and query timings are app-customizable for the first time, with server/client parity.
- f9d2dce: The core ui's bootstrap stubs are now generated, not authored: the web entry, hydrate bootstrap, SSR router module, compose expose, and globals are emitted as `.gen`-suffixed, gitignored files by the framework's code-artifact generation pass (`bos dev`/`build`/`typecheck`), regenerated from the installed package version. The build surface retargets to the generated paths and core-ui detection no longer requires an entry stub. Sync drops the retired stub files from its ownership list and tolerates templates that no longer ship a file. Per ADR 0023.
- d57b8f4: UI route grafting foundation: grafted ui-plugin composition, digest-cached SSR compose, plugin ui SSR fields, mf-build shared surface

  Adds `everything-dev/ui/compose` (`composeApp`, mount registry, deterministic graft order, staticData.nav manifest, digest helper, compose cache) and `everything-dev/ui/mf-build` (`createUiSharedDeps` catalog-enforced singleton list, `pluginUiDeployFields`, engine entries) subpath exports. `plugins.<id>.ui` gains `ssr`/`ssrIntegrity` fields so plugin ui remotes contribute server route-tree exposes; the core `ui` remote now also exposes `./tree` for grafting. Host gains `services/ui-compose.ts` (digest-keyed composed tree cache wired into the SSR handler — opt-in via `BOS_UI_COMPOSE=1` until grafted-route client composition ships) and CSP origins for plugin ui remotes.

- d57b8f4: The core UI rsbuild config is synthesized when the ui workspace has no local `rsbuild.config.ts` — the every-plugin generated-config model. The ui package's dev/build/preview scripts route through the new `bos-ui` bin (`everything-dev/ui-build`), which honors a local `rsbuild.config.ts` as an override and otherwise generates one from the shared `every-plugin/ui/mf-build` factory (provider role, `CORE_UI_PLUGIN_KEY`, the web/node exposes, public copy, and the `APP_NAME`/`APP_ACCOUNT` defines derived from the resolved runtime config). The config drops from the scaffold: `bos init` no longer copies it and `bos sync` treats an existing child config as app-owned. Closes #187. Also raises the ui lib target to ES2024 (`Promise.withResolvers`).
- f9d2dce: Sync stops managing every ui source file — the app owns its ui after init (ADR 0023): `router.tsx` (the router policy seam, including the query-timings export), `app.ts` (the `@/app` surface), lib, routes, components, providers, and hooks are scaffolded once and never overwritten. `bos sync`/`bos upgrade` migrate children off the retired bootstrap stubs: unmodified copies are deleted silently, hand-modified copies are backed up first, and the result reports both. Framework behavior flows through package versions from here.
- d57b8f4: Unified dev-session log pipeline: normalize → classify → level-filter → broadcast to the screen tail, log file, and `l`/shutdown export. Adds `bos dev --log-level` (error|warn|info|debug, overrides `BOS_LOG_LEVEL`; `DEBUG` still shows everything), collapses multi-line Effect Logger objects and stack traces, folds `LOG_NOISE_PATTERNS` into the classifier, collapses `[Database]` startup runs to a single `db ready` event per plugin, and logs clean SIGTERM quits at info instead of `[ERR]`. The log file now always receives every line.
- 9191ab3: Deploy-identical dist builds, unified bundle resolution, pin-enforcement fix

  - `bos deploy` workspace builds are now dist-first with no source maps (DEPLOY=true) — the same mode the universal image's dist-builder uses, so image bytes and CDN-uploaded bytes are built identically.
  - The universal image's prod-builder prunes node_modules to the union of every workspace's production dependency closure (dev-only-deletion; nothing hand-curated).
  - The bundle fetch interceptor resolves own-namespace URLs with one layered policy — staged disk → network — so a partially-staged namespace boots over the wire instead of 404ing; own-namespace misses never touch the write-through cache (stays scoped to foreign namespaces). Template-plugin dist leaves the image and loads from the CDN as a consequence (ADR 0021 amendment).
  - Pin enforcement no longer fires on configs without a production form — the image's baked boot fallback no longer crashes `bos start` under NODE_ENV=production before the registry fetch runs.
  - CI gains a runtime-image smoke gate: boots the built image the way production does (env identity → published config → staged bundles), asserts health/SSR/API + `bos mf check`, and prints image size.

- ## d57b8f4: Universal runtime image (ADR 0021): tier auto-detection — an identity whose namespace is not staged under `BOS_BUNDLE_DIR` drops to registry tier (network fetch + `BOS_BUNDLE_CACHE_DIR` stale-if-error cache) instead of deterministically 404ing own-namespace URLs; the host's `/bundles/*` FS route is namespace-scoped (foreign namespaces fall through to the proxy handler). Dockerfile: the deployable stage is named `runtime` (last, default target); the regression fixture is `regression`. The deploy train pushes the image to GHCR by SHA-tagged digest and Railway deploys the pushed digest.
- 3e47fea: Version-aware runtime image tags: `bos deploy` now pushes the exact `v<version>` tag (and a floating `v<major>` tag on stable releases) alongside `sha-<short>`. `:latest` is held while the workspace version is a prerelease — the Docker analog of the npm `rc` dist-tag — so deployments pulling `:latest` keep serving the last stable image until a stable release moves it.
- d57b8f4: Atomic deploys tickets 09-10: the MF integrity fetch hook now treats an SRI mismatch like an origin failure — last-known-good bytes from the bundle cache serve instead (with `x-bundle-cache: stale`) and corrupted origin bytes are never written into the cache; the host process installs the outbound bundle-fetch tier (staged own-namespace reads + stale-if-error). The host serves `GET /.well-known/version` with the deploy fingerprint, which rides the client config; a soft-refresh banner (`version-refresh-banner`) polls it for signed-in sessions and offers a reload when a newer deploy is served.
- d57b8f4: Version observability (atomic-deploys 12): `GET /.well-known/version` now returns the per-slot manifest pins from the adopted pointer and the watch fiber's last-tick outcome beside the fingerprint; `pointerFingerprint`/`slotPins` are shared so CLI and host compute the same identity. Every publish writes the per-deploy manifest key (audit trail, previously wallet-only), prints the fingerprint + pins, and returns them. `bos deploy --status` lists recent publishes newest-first from the manifests key family; `bos status` reports the deployed-vs-served fingerprint delta — the split-brain detector. The admin dashboard gains a version card (`admin-version-card`) reading the version endpoint, and `/llms.txt` + `/skill.md` document the surface for agents.

### Patch Changes

- d57b8f4: Add platform-admin node structure and validator reporting pages, plus a proposal review queue with approve and reasoned reject actions. Ensure remote auth contracts without additional type exports receive a generated fallback so repository typechecks remain usable.
- d57b8f4: Audit and fix agent information flow for first-load discovery.

  - Rewrote `ui/public/skill.md` with two explicit agent modes: talk to the app via MCP/REST (with API key auth instructions), and clone & modify (with AGENTS.md reference, architecture notes about Module Federation code bundles, and regression test info).
  - Expanded `ui/public/llms.txt` to include API, MCP, auth, and repository source sections.
  - Added `/.well-known/mcp.json` host route for MCP discovery (server name, endpoint, transport, auth scheme).
  - Deleted stale `LLM.txt` (superseded by AGENTS.md).
  - Created `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md` to resolve dangling AGENTS.md references.
  - Added agent communication surface section and `.agents/skills/` workflow skills mention to AGENTS.md.
  - Added `/settings/api-keys` route with API key create/list/delete UI and API Keys tab in settings layout.
  - Exposed auth and plugin router routes as MCP tools (in addition to base API) in `mountMcpRoute`.
  - Updated `buildChildAgentsInstructions` in init.ts with MCP/API-key sections and "remotes are code bundles" note.
  - Added child `llms.txt` and `skill.md` template generation in init.ts `personalizeConfig`.
  - Added MCP endpoint regression test (`mcp_test.go`), agent surface content tests (`agent_surface_test.go`), and browser test for settings API keys page.

- c520871: The API client retries rate-limited (429) responses up to three times, honoring the server's `Retry-After` (capped at 2s) before failing — transient edge saturation self-heals in queries and the session check instead of surfacing errors.
- d57b8f4: **BREAKING for child projects (sync-surface change):** `createAuthMiddleware` moved framework-home — it is now exported from the new `everything-dev/api` subpath (src in dev, dist in prod, mirroring `everything-dev/ui/auth`) and is generic over the workspace's auth context (`createAuthMiddleware<AuthContext>(builder)`); the five near-identical copies (`api/src/lib/auth.ts`, `plugins/*/src/lib/auth.ts`) are deleted and `bos sync` no longer owns or restores `lib/auth.ts` paths. Child projects: import `{ createAuthMiddleware }` from `everything-dev/api` and source `AuthContext`/`AuthOrganizationContext` types from the generated `auth-types.gen.ts` (`AuthPluginContext` is the same type the old copies aliased). Out of scope, unchanged: the `DecoratedMiddleware`/`.use()` typing limitation advisor-plan 007 noted.
- d57b8f4: Port allocation is now atomic block allocation (ADR 0012 §3/§4): `bos dev --port N` derives the whole layout deterministically (api N+1, auth N+2, ui N+3, plugins N+10…) and the block is probed and acquired as a unit — a busy port anywhere in the block moves the entire block (+100) instead of shifting only the ports after it, so layouts can never end up half-shifted. Explicitly-passed port flags are pinned: if that exact port is occupied, allocation fails loudly naming the port and holder instead of silently drifting it. When the block does drift, a prominent notice lists who holds the preferred range (live sibling sessions via registry claims, foreign processes via the lsof ownership probe). Only explicitly-passed port flags are persisted to `.bos/infra-state.json` (merged with previous explicit choices) — drift is never persisted, so restarts always re-try the preferred base. Registry entries gain a lease key + refcount-ready shape (backward compatible) for the upcoming shared-plugin broker. Deletes the production-dead divergent allocator (`prepareDevelopmentRuntimeConfig`) and the destructive `.env`-rewriting dead materializer path whose test certified `BETTER_AUTH_SECRET` rotation and user-key loss.
- d57b8f4: fix(auth): derive cookie Secure from the baseURL protocol, not NODE_ENV

  The regression container serves http://localhost:<port> in production mode.
  `advanced.defaultCookieAttributes.secure: isProduction` forced the `Secure`
  attribute onto every better-auth cookie (spreading after the baseURL-derived
  value), so cookies set over plain http were never sent back — sign-in
  succeeded but every session-bearing request 401'd. The Secure attribute and
  the `__Secure-` name prefix now derive together from the baseURL protocol via
  `advanced.useSecureCookies`: https deployments (production, staging) are
  unchanged, http origins issue sendable cookies.

- d57b8f4: Fix `bos dev` stacks whose `app.auth` plugin has a local folder-form ui (`plugins/auth/ui`): the atomic port-block allocator (ADR 0012) stopped reserving a `plugin-ui:auth` port for the auth mirror, so the runtime config advertised an empty auth ui url — the browser could never load the auth remote and the `/login` page never rendered (both dev regression browser suites failed). The mirror's ui surface now gets a block-allocated port again and the planner patches `plugins.auth.ui.url` with it. Regression stack logs drop the colon (`regression-dev-ssr.log`) so failed-run artifact uploads no longer bounce off upload-artifact's invalid-character check.
- d57b8f4: `bos kill` is now as disciplined as the session's own teardown: it escalates SIGTERM → 5s → SIGKILL on the process group (the old single-signal kill left anything that ignores SIGTERM — rspack watchers especially — alive forever), reaps orphaned child processes even when the session's own pid is already dead (a SIGKILLed orchestrator used to leave its whole detached tree unkillable by any `bos` command), verifies every claimed port is actually releasable before unregistering (reporting the surviving holder's pid and command when it isn't), and is idempotent. New `bos dev` sessions adopt the same way: at startup they reap orphaned children from dead same-project sessions before allocating ports, so a stale session can no longer poison the next run. Fixes a registry bug where unregistering a dead session's pid was a silent no-op (the entry stayed in `~/.cache/everything-dev/pids.json` forever). Adds an ownership probe (`lsof`-based) used in the port-still-bound reporting.
- d57b8f4: Build output hardening for the platform deploy path.

  - Show all stdout during deploy builds (not just chunks matching a provider regex). Chunks can split across boundaries so a filtered URL never matched — deploy builds now pass all stdout through unconditionally.
  - Extract build-result classification as a pure function from the build attempt, making the exit-code classification testable without spawning processes.
  - Fix variable shadowing where inner `const result` shadowed the outer `await run(...)` binding.
  - Remove the unnecessary per-workspace env copy.

- d57b8f4: Update `buildSignedDelegateAction` callbacks in the citynode UI to the two-argument `(builder, receiverId)` form required by `better-near-auth` 1.10.x and the documented `near-connect` skill, and pass `receiverId` into `functionCall` in place of the previously hard-coded `prepared.data.contractId`. This matches the new callback signature in both signature shape and behaviour since `buildSignedDelegateAction` forwards its receiverId to the builder callback.

  Make `init.full.test.ts` permissive about custom UI/API implementations: it now scaffolds `["template"]` only (no proposals, votes, apps), writes a permissive gen-file stub after `types:gen` runs, and only typechecks `api` and `plugins/_template`. The full UI scaffold typecheck moved out of the regression because `ContractRouterClient<T>` reproduces its conditional shape for any stubbed `T`, and pinning the typecheck against citynode-specific plugin-namespace calls would couple the regression to a specific configuration.

  Restore the missing `checkCdnProviderDeployable` export from `packages/everything-dev/src/build.ts` so the framework tarball build (a prerequisite of the test) no longer fails on the pre-existing broken `publish.ts → build` re-export.

- 9191ab3: The build train's children run pnpm, not npm (ADR 0026 completion): `buildWorkspaceTargets` (target + default spawn), `ensureFreshDeps` (prerequisite rebuilds), and the container dist builder spawn `pnpm run build` instead of `npm run build`. The deploy CLI is itself a pnpm run-script, so pnpm exported its workspace settings (`node-linker`, `catalog`, `link-workspace-packages`, `overrides`, …) as `npm_config_*` env vars — every npm child then warned `Unknown env config` (one wall of warnings per workspace, and npm's next major drops unknown env configs). pnpm children read those settings natively; the warnings are gone and the fleet posture is uniform.
- d57b8f4: `bos build` reports unknown/unsatisfiable targets instead of a bare "[CLI] Unknown error": invalid target names get "Unknown build target(s): … — valid targets: …" (framework packages build via the prerequisite train), remote-only/no-match selections get "Nothing to build — no local targets matched: …", and a missing bos.config.json says so. `BuildResultSchema` now carries the `error` field the CLI already tried to print.
- d57b8f4: CI overhaul: workflow_run deploys, no commit-back, drop dead postinstall everywhere.

  - Deploy/staging workflows (repo + child templates) trigger via `workflow_run` on CI success and check out the exact CI-validated SHA; the notify/`repository_dispatch` job is gone.
  - The "Commit and push bos.config.json updates" step is removed from deploy/staging — the runtime fetches config from FastKV via `BOS_ACCOUNT`/`BOS_GATEWAY`, so deployment URLs never need committing (everything-dev#243).
  - All `bun run postinstall` steps removed from every workflow; child scaffolding no longer writes a `postinstall` script (dead code under `ignore-scripts = true`; `bun typecheck`, `bos dev`, `bos build`, and `bos publish` regenerate types on demand).
  - `release.yml` drops unused `packages: write`; `docker.yml` drops its never-called `workflow_call` trigger; `@railway/cli` is pinned; missing job timeouts added.

- d57b8f4: CLI hygiene batch (plan 041): removed two dead `@effect/platform` dependencies (zero imports, one peer-incompatible with the vendored effect pin); `zod` is now a real dependency of the published package (the CLI imports it at boot; it was peer-only, which crashes under strict-peer installers); `@types/node` and `vitest` now follow the root catalog; the CLI flag parser reads its input schemas from an exported, compile-checked `commandOptionSchemas` map instead of reaching into oRPC's private `~orpc` internals through an `any` cast; AGENTS.md no longer documents a nonexistent `bos info` command; and the snapshot-hash helper, duplicate-object SQLSTATE list, and NEAR CLI install check each exist in exactly one place.
- d57b8f4: Invalidate configuration discovery caches and safely search relative paths through the filesystem root. Treat duplicate runtime dependencies as a single graph edge.
- 95261fe: Consumer-coupling fixes: the deploy image leg skips with a notice when no Dockerfile exists at the config root (children fetch the universal image — ADR 0020/0021) and `bos init` no longer scaffolds a Dockerfile into fresh children; `bos pluginAdd` with a remote URL switches the plugin to remote (drops a conflicting `development: local:` entry — dual local-dev/prod-URL mode is now hand-edit only); the typegen write pass sweeps stale per-plugin `plugins-client.gen.ts` / `auth-types.gen.ts` and `.bos/generated/plugins/<key>` dirs for plugins that flipped local→remote or were removed; the local api/auth contract fallbacks fail loudly instead of emitting imports to missing files; config reads fall back form-aware — `readBosConfigForBuild` prefers the materialized resolved snapshot, then the authored `bos.app.ts` descriptor, then legacy `bos.config.json`, and `bos registry use` reads the authored descriptor before the legacy JSON.
- d57b8f4: Fix `bos sync` leaking parent-only root `package.json` scripts into child projects. When syncing the root package, scripts are now filtered to the child-appropriate set generated by `buildChildRootScripts`, so parent-specific commands (regression tests, etc.) no longer appear in child projects and child script values (e.g. `typecheck`) stay correct.
- d57b8f4: Tenant creation on the admin dashboard now requires connecting a sputnik-dao account via the Trezu wallet (separate from the existing SIWN session wallet). The connected DAO account owns the new tenant: `tenants.accountId` is the DAO, `bos.config.json` is published at `bos://<dao>/<gateway>` and inherits the platform base. The API gains `requireAdmin` + a server-side `get_policy` view call that confirms the session user's primary NEAR account appears in an explicit DAO policy group before accepting the create. `tenants.owner_kind` (default `platform`) is added to flag DAO-owned rows and to gate the DAO-aware republish flow.

  The platform subaccount flow (`siwn.subAccount.*`, `NEAR_SUB_ACCOUNT_PARENT_KEY_*`) is removed. Existing tenants created before this update keep working — the host is account-agnostic — but the admin wizard is now DAO-only.

- d57b8f4: Fix `db studio` for local plugins: `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.

  drizzle-kit loads drizzle.config.ts through its bundled tsx CJS transform, which defines `import.meta.url` but not `import.meta.dirname` — so plugin configs derived their migration slug from `npm_package_name ?? "unknown"`, looked up a nonexistent secret (`UNKNOWN_DATABASE_URL`), and silently fell back to a `pglite:` pseudo-URL that the pg driver parsed into a passwordless connection.

  The database tooling is rebuilt around explicit database identity:

  - New pure primitives in `everything-dev/db`: `workspaceIdentityFromModuleUrl` / `workspaceIdentityFromWorkspaceDir` (slug, secret name, journal coordinates, workspace dir — derived once from the workspace `package.json`) and `resolveDatabaseUrl` (env → nearest `.env` → loud error for connection-requiring drizzle-kit commands → in-memory pglite placeholder only for `generate`/`check`).
  - All workspace drizzle configs (`api`, `auth`, `proposals`, `votes`, `_template`) now derive identity from their own module location and fail loudly when the database secret is missing, instead of silently migrating an empty in-memory database.
  - `DatabaseBindings` and `DrizzleKit` Effect services: typed resolution of plugin → database binding and a single spawn choke point that materializes the canonical secret into every drizzle-kit child process (also fixes the latent same bug in `db repair`).
  - `bos db studio` now runs through the services; behavior of the CLI output is unchanged.

- d57b8f4: Fix host crash after login caused by a pg-pool search_path race.

  - The `on("connect")` handler in `api/src/db/index.ts` and `plugins/_template/src/db/index.ts` ran `CREATE SCHEMA` and `SET search_path` concurrently with the first query on each fresh connection. pg-pool does not await `on("connect")`, so after idle connections closed (30s timeout) the next query (e.g. `listRootNodes`) could land before `SET search_path`, hitting `relation "nodes" does not exist` in the `public` schema. The concurrent `client.query()` calls also produced `Connection terminated` errors (the deprecation warnings at startup were the same root cause).
  - Set `search_path` at the protocol level via the pool's `options` config (`-c search_path=<schema>,public`) so every connection has it before any query. Move `CREATE SCHEMA IF NOT EXISTS` to a one-time `pool.connect()` call before returning the driver, eliminating the race entirely.
  - Add `uncaughtException` and `unhandledRejection` handlers in `host/src/program.ts` so a dropped DB connection logs an error instead of killing the host process (which cascaded to SIGTERM of all dev services).
  - Fix Docker healthcheck to specify the correct database (`pg_isready -U everythingdev -d api_db` / `-d auth_db`), eliminating the `FATAL: database "everythingdev" does not exist` log spam every 3s.
  - Harden `bos db:studio` local path to pass the resolved `*_DATABASE_URL` explicitly to the spawned drizzle-kit process, fixing the `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` error when dotenv `override: false` left a stale empty shell env value in place.

- d57b8f4: fix(db): treat `*.railway.internal` database hosts as local (no TLS verification)

  `resolvePoolSsl` verified certificates for any bare non-local URL, but Railway
  private-network Postgres (`auth-db.railway.internal`, `api-db.railway.internal`, …)
  presents a self-signed certificate chain no client CA bundle can verify — plugin
  and auth boots failed at migration/driver with `self signed certificate in
certificate chain`. Those hosts are VPC-scoped private traffic, so they now fall
  into the same no-TLS bucket as `localhost` / `host.docker.internal`.

- d57b8f4: Client compose degradation builds a real core-only route tree. When client composition
  failed (a plugin remote's chunk load error, a digest mismatch) the hydrate bootstrap
  passed `routeTree: undefined` to `createRouter`, leaving the router's `routesById`
  unset — every page then crashed with `Cannot read properties of undefined (reading
'__root__')` instead of degrading. Compose failure or digest mismatch now constructs
  the core-only tree from the payload's core manifest plus the app route config and
  client-renders it (never hydrates over SSR'd composed HTML); a router created without
  any tree fails loudly at creation instead of crashing cryptically during render.
- d57b8f4: Deploy folder-form plugin uis and harden SSR composition against ui-less remotes.

  - **Folder-form plugin ui deploy**: `bos publish --deploy` now uploads `<plugin>/ui/dist` (web `remoteEntry.js` + `ssr/remoteEntry.server.js`) as its own bundle key (`<key>-ui`) and pins `<slot>.<key>.ui.production` / `.integrity` / `.ssr` / `.ssrIntegrity` in `bos.config.json`. Previously these fields were never written, so a deployed plugin ui (e.g. `app.auth.ui`) resolved with an empty production URL and production boot crashed.
  - **SSR composition guard**: the host skips plugin ui sources with no production URL (logged warning naming the plugin) instead of crashing SSR composition with `TypeError: fetch() URL is invalid` from a relative `/mf-manifest.json` fetch.
  - **Config resolution guard**: a remote ui target with no URL drops out of runtime resolution entirely instead of resolving to `{ source: "remote", url: "" }`.

- d57b8f4: Fix `run()` capturing empty stdout for successful subprocesses — the deploy image leg falsely failed with "Failed to resolve the current git SHA". Reads the settled execa result instead of the promise object, and reports missing binaries (ENOENT) as failures instead of exit code 0.
- d57b8f4: Remove deploy lock feature and add `bos infra export` command.

  - Removed `bos deploy lock acquire/release/inspect` commands and FastKV-backed deploy lock logic. Concurrent deploys now follow last-write-wins semantics (harmless redundancy for Railway redeploy).
  - `bos infra export [--target ci|local] [--network mainnet|testnet]` emits `{env, services, account, gateway, project, generatedAt}` JSON. The deploy workflow consumes this to populate `$GITHUB_ENV` instead of repeating `API_DATABASE_URL`, `AUTH_DATABASE_URL`, and `CORS_ORIGIN` literals. Host port comes from `BOS_CI_HOST_PORT` env or `runtimeConfig.host.port`.
  - `buildOriginMap` now derives plugin origins from `runtimeConfig.plugins[id].extendsRef` / `runtimeConfig.auth?.extendsRef` (already populated by `loadResolvedConfig`), removing the duplicate raw-JSON read and the parent-runtime fallback logic.
  - New tests cover the CI plan builder and the resolved-config origin lookup.

- 9191ab3: Deploy prerequisite builds run in the deploy build mode. `ensureFreshDeps`' children (the prerequisite train) now receive the same `DEPLOY=true` / `NODE_ENV=production` env as the target builds they precede — previously they ran with the invoking shell's ambient env, so a bundler-config workspace in the prerequisite closure (host, force-rebuilt via the registry plugin's dependency edge) loaded its rsbuild config in source-first mode and died in jiti before any output. The build-mode contract now lives at one seam: `buildWorkspaceTargets` builds the env once and both the prerequisite loop and the target loops receive it. Also drops the vestigial `"host": "workspace:*"` devDependency from `plugins/registry` — nothing imports host; it only dragged host into every deploy's prerequisite closure for a doomed duplicate build.
- d57b8f4: Dev bootstrap rewritten as one Effect program (`ShellEnv`/`ProjectEnv` as services).

  - `bos dev` and `bos start` run `planInfra → loadProjectEnv → syncEnvFile → mergeEnvTiers → preflight` inside a single Effect program with tagged error channels (`DevStepError`, `DevConfigMissing`, `DevPreflightFailed`, `StartFetchFailed`, …); the oRPC handlers are now thin `Effect.runPromise` seams. Progress events and phase timings are unchanged.
  - `ShellEnv` is a `Context.Service` captured as the program's first step — before any `.env` loading — and handed to the spawn side through the parked dev session; the module-scope `shell-env.ts` snapshot and `cli/infra.ts`'s `loadProjectEnv`/`ensureEnvFile`/`syncEnvFile` loose helpers are gone (unified behind `ProjectEnv`, which also serves the database-bindings `loadEnv` delegate).
  - Pure merge helpers (`composeSpawnEnv`, `mergeGeneratedOverFileEnv`) stay pure functions; three-tier precedence (shell > generated > `.env`) is unit-tested at the single merge point. No behavior change to the spawn env the regression harness injects.

- f151e1b: `bos dev`'s log pipeline now promotes rsbuild/rspack build diagnostics (`File: …` and `× …` lines) to error level. rsbuild writes the `Build error:` title to stderr with an empty message and the actual diagnostics to stdout, which the default warn display filter dropped — the dashboard showed an unhelpful bare `Build error:` while the cause was only visible in `.bos/logs/dev-latest-*.log`.
- d57b8f4: `bos logs` resolves the newest session's log by session start time (parsed from the file header) instead of file mtime, with a pid tie-break — fixes wrong-session resolution when mtimes tie on coarse-grained CI filesystems or when an older session has written more recently.
- d57b8f4: Dev-stack origin/precedence fixes, log ergonomics, and composed-SSR hardening.

  - **Generated env wins at spawn time**: the planner's `envGenerated` (CORS_ORIGIN, DB URLs) is now provided to the orchestrator and overlaid on the spawned services' env — a stale `CORS_ORIGIN` pinned in `.env` can no longer break Better Auth's trusted origins when dev ports drift (e.g. host on :3008 while `.env` says :3000, which made every post-login session check fail with "Something went wrong before the app layout could render").
  - **bos-owned `.env` lines auto-refresh** on port drift (only keys the generator owns; user-added lines untouched), with a `[env]` log line per change. `loadProjectEnv` now runs before the env merge so preflight sees the real values.
  - **Auth origin diagnostics**: the host logs the effective Better Auth origin + trustedOrigins at boot and warns when `CORS_ORIGIN` does not include the host origin.
  - **SSR error visibility**: every SSR response carries an `x-request-id`; composition/stream failures log it, the CSR-shell fallback renders it, and the router's `defaultOnCatch` logs caught render errors server-side. The shell also escapes the error message and page title (HTML injection).
  - **Manifest fetch cache**: remote plugin manifests are TTL-cached (30s) with a last-good snapshot fallback — one flaky plugin host no longer 500s every SSR request, and the digest variant cache no longer sits behind per-request fetches.
  - **Variant cache invalidation**: composed SSR variants key on the structural digest PLUS a deployment fingerprint (SSR integrity in prod, local manifest mtime in dev), so code-only redeploys and dev rebuilds recompose instead of serving a stale tree forever. A server-side digest cross-check fails loudly if the engine's digest disagrees with the manifest inputs.
  - **Share-scope + module-cache fixes**: expose loads bypass the MF runtime module cache when a remote's entry URL changed (no more mixed-version composed trees after integrity bumps), and share-scope initialization is serialized across concurrent loads.
  - **Composition guards**: cross-plugin path collisions under the same parent are hard errors (also enforced per-workspace at manifest generation, as the generator docblock always claimed), and layout routes declaring options composition would drop (loader/beforeLoad/head/staticData) fail loudly instead of being silently ignored.
  - **Log ergonomics**: multi-line log entries are prefixed per line in `.bos/logs` (Effect's pretty-printed JSON no longer breaks the `[source]` prefix), MF registration/constructor spam is demoted out of logs and the TUI unless `DEBUG=1`, and a new `bos logs [service] [--follow] [--tail N]` command reads the dev session log.

- d57b8f4: Fix dev process-tree teardown leaking detached service processes.

  - Service kill now signals the child's whole process group (SIGTERM, then group SIGKILL after a 3s grace) instead of SIGTERM-ing only the direct child. The old path relied on a group-SIGKILL fallback that only ran if the direct child ignored SIGTERM — wrappers that exited quickly left their detached grandchildren (rspack/tsx) un-signaled and orphaned.
  - The 5s force-exit now group-SIGKills every known child before exiting, so a slow graceful shutdown can no longer strand services mid-teardown.
  - The PID registry now records child pids per session, and `bos kill` signals each child's process group, so `bos kill --signal SIGKILL` reaps full trees even when the CLI process is already gone.
  - Browser regression harness no longer reuses a pre-existing server (`reuseExistingServer: false`) and kills stale port squatters before boot (mirroring the Go HTTP harness), so aborted runs can't poison the next run with a half-dead stack.

- d57b8f4: Dev-session display/lifecycle defect batch (plan 037 phase 3):

  - Piped/non-TTY sessions no longer freeze after the 100th log event — printing is sequence-based, not array-position-based, so CI and `| tee` runs keep streaming for the whole session.
  - `--interactive` with a non-TTY stdin now falls back to the incremental (non-alt-screen) renderer instead of crashing on `setRawMode`; interactive mode additionally requires the output side to be a TTY.
  - A service child that dies after becoming ready now flips its table row to "failed" (unclean exits only — the polite SIGTERM/SIGINT quit still renders cleanly); previously the row kept showing "running" for a dead service.
  - Status detection: ready patterns win over error patterns on overlapping lines, and the host/ui error patterns no longer match benign lines like "compiled successfully (0 errors)" or "build finished: 0 failed" (`\berror\b(?!s)`, `\bfailed to\b`, `\bbuild failed\b`).
  - A spawn failure (e.g. ENOENT on the command) surfaces immediately as a "Spawn failed" error log + failed row, instead of a silent 90-second "starting" hang.
  - Per-session log filenames (`dev-<ts>-<pid>.log`, `dev-latest-<pid>.log`): two concurrent `bos dev` sessions in one project no longer truncate each other's logs; `bos logs` resolves the newest session's file by mtime.
  - The plugin row's UI annotation no longer renders `ui :0` when the ui port is unset.

- d57b8f4: `bos dev`/`bos start` sessions can now be quit at any lifecycle phase. Previously a shutdown request during startup (services still starting, up to the ~120s readiness window) succeeded a deferred nothing observed and the 5-second force exit ran a no-op kill — orphaning every detached service child (the "zombie session squatting ports" class). The kill finalizer and emergency kill are now registered before the first child spawns and cover each handle incrementally as it spawns, and the startup phase races against shutdown so a quit request interrupts service startup, kills everything spawned so far, and exits cleanly (code 0). Also: remote-host sessions no longer list their own process as a child (a force exit used to SIGKILL the CLI itself, exit 137); unhandled defects now exit non-zero (previously `bos dev` always exited 0, so harnesses could not detect failure); and the 5-second force-exit timer is re-armed at finalizer entry so a large log export is no longer SIGKILLed mid-print.
- d57b8f4: The dev TUI's quit path escalates like signals do: the first `q`/Ctrl+C (or `l`) starts the polite shutdown with the 5-second force-exit timer armed, and a second press force-kills even when graceful teardown is wedged — previously the quit path succeeded the shutdown deferred without any timer and swallowed every further key press, so a hung teardown froze the terminal with no escape. The terminal (cursor, alt-screen, raw mode) is also restored on every exit path, including force exit.

  The interactive repaint is now viewport-bounded: the frame is capped to the terminal height (log tail trims to fit), lines are clipped to the terminal width with ANSI-aware truncation, and repaints no longer clear the whole screen (`\x1b[H` + erase-below instead of `\x1b[2J`) — long log lines no longer overflow the alt-screen into scrollback.

  Also fixes a pre-existing typecheck failure in `service-descriptor.ts` (the `SERVICE_CONFIGS` record indexing made every lookup possibly-undefined under `noUncheckedIndexedAccess`, breaking the descriptor spreads).

- d57b8f4: Dev TUI display hardening: every repaint now erases to end of line (`\x1b[K`), so rows that shrink between frames (the ready summary, status text, log tail) no longer leave residue from earlier frames mid-row. The renderer also stops painting entirely after unmount — late log events and the final flush can no longer repaint a stale frame onto the shell after quitting — and unmount is idempotent, so calling it twice (e.g. from both `restoreView` and the session finalizer) restores the terminal exactly once. Shutdown/force-exit messages now print after the alt-screen is restored, so "[Dev] Shutting down..." is actually visible instead of being written into the TUI frame and destroyed.
- d57b8f4: Harden Device Link sign-in from phone to desktop:

  - The device token endpoint now records a single-use claim for the session token it issues (stored hashed, bound to the client id, ~60s expiry). `/device-link/claim` now requires `client_id`, sets the cookie only for an unconsumed, unexpired claim issued to that client, and consumes it; arbitrary session tokens are refused. `bos login` sends its client id with the claim.
  - Device code requests are accepted only from the configured `deviceLink.clientId` and the bos CLI (`bos-cli`); any other client id is rejected.
  - The desktop session starts in the organization the member most recently joined.
  - The login redirect sanitizer allows the device approval path, so a signed-out phone signs in and returns to approval with its `user_code`; login redirects now navigate by `href` so query strings survive.
  - After a Device Link sign-in the desktop offers "add a passkey on this device"; dismissal is remembered per device.
  - The onboarding success screen replaces "Set up your NEAR wallet" with a "Continue on your computer" step pointing at the Gateway Origin.

- 4d8efd1: Consolidate the plan tree under `docs/plans/`: merge `advisor-plans/` (the advisor audit queue) and `plans/` into one directory — audit plans sit flat, thematic subdirectories (beta-v2, wayfinder, prototypes, deploy-agents-rebuild, extensions, infra, offline, v1-current) and `done/` hold the rest. Plans markdown is now first-class tracked (the old `plans/` gitignore regime silently dropped new files). Rewrite the `/improve` skill to write plans into `docs/plans/` (advisor-plans fallback removed). Fix stale `metadata.sources` in the `api-and-auth`, `plugin-development`, and `ui-integration` skills, and point the scaffolded AGENTS.md text at `GLOSSARY.md` (renamed from `CONTEXT.md` to match the upstream skill ecosystem).
- 95261fe: Pull postgres/redis images from the ECR Public mirror. The CI infra-export plan, the scaffolded `docker-compose.yml`, and this repo's workflows/Dockerfile now reference `public.ecr.aws/docker/library/*` instead of Docker Hub — GitHub-hosted runners (and any CI behind shared egress IPs) were hitting Docker Hub's unauthenticated 100-pulls-per-6h rate limit before any `docker login` step could run. CI service images in this repo's workflows are additionally digest-pinned (`repo:tag@sha256:<digest>`) and kept current by a Renovate regex manager; generated/local artifacts keep floating tags.
- d57b8f4: Effect hardening pass 2 (#151): compose and client-config caches live behind host server-layer services with scoped finalizers; federation/local-dist teardown is owned by `FederationLifecycle` (manual `reset*` exports removed); local-container and orchestrator readiness probes use `Schedule` + `Effect.timeout` with the same cadences. Also skips plugin ui sources with no production URL so SSR composition does not crash on a relative manifest fetch (aligns with open #265).
- 95261fe: Adopt the Effect idioms left after the lint cleanup (port of citynode.app#328): `timedPhase` (Effect.fn + Clock + Effect.exit) replaces the async `timePhase` internals — `ProgressEvent` drops its unused `message` field; `isDebug` consolidates the ad-hoc `DEBUG` checks; `devBootstrap`/`startBootstrap` drop the `BootstrapHelpers` injection (the module-level `resolveProxyUrl` is called directly); host compose, federation, and plugin loading convert to `Effect.fn` generators; core and plugin route configs share one `routeConfigLoaders` validation (a routeConfig expose missing it now fails loudly, including for core ui loads); `enforceCacheLimit` generalizes to the stored value type so the compose variants cache uses it.
- d57b8f4: Add staleness-aware quiet build for the workspace `better-near-auth` package. `bos build` and `bos dev` now build `packages/better-near-auth` dist alongside every-plugin/everything-dev so production rspack plugin builds that bundle `better-near-auth` resolve its `dist` output.
- d57b8f4: Fail-loud sweep in the dev session: descriptor env now rides the generated tier (shell-exported values keep outranking it, as documented and test-pinned) instead of silently outranking everything via a post-spawn `Object.assign`; a failed `.env` load propagates into the database-binding error instead of proceeding fire-and-forget; `bos logs --follow` refuses to watch a missing/unknown log file and stops cleanly when the followed file is rotated or deleted (the readFile rejection is handled); warning suppression around runtime-config builds is failure-safe via a release finalizer at both the development and start sites; `DB_LOCK_TIMEOUT_MS`/`DB_IDLE_TX_TIMEOUT_MS`/`DB_STATEMENT_TIMEOUT_MS` parse defensively (explicit `0` disables, garbage fails the boot); and the start path now passes the generated env tier through to the session instead of silently running with an empty one.
- d57b8f4: Fix dev/regression builds shipping hashed MF entry names, and make the regression start fixture pin its slots. `isBuildInvocation` now keys on an explicit `BOS_DEV_SERVER=1` stamp (dev servers mark their own bundler children) instead of NODE_ENV/DEPLOY — vitest's `test` env and the bundler CLIs' `production` default can no longer misclassify a dev server, and every non-dev build (local, host-test, container, deploy) emits content-hashed entries + build reports. The host rsbuild config adopts the same hashed-entry + report contract, making `app.host` pinnable by the deploy train. Slot pins resolve against the slot's remote base (`remoteUrl`), not the host's listening URL. The regression container-build composes per-slot version manifests (local SRI) and stamps `pin: {manifest, integrity}` into the variant configs — ADR 0009 amendment: pins are the only production slot shape — and the version manifests' `ssr.entry` carries its `ssr/` path segment so derived `ssrEntryUrl` points at the real bytes.
- d57b8f4: Fix stale workspace dist breaking dev servers and false "Process failed" statuses in bos dev.

  After moving plugin sources into the repo, `bos dev` showed TEMPLATE/API as failed although both servers ran: rspack dev servers bundle workspace packages from their `dist` exports, and `bos dev` skipped rebuilding `packages/everything-dev` whenever a dist existed — so new exports (e.g. `isRetryableMigrationError`) were missing from dev bundles, producing ESModulesLinkingWarning and silently inactive fixes. Separately, the plugin error pattern `/error/i` matched the substring "Error" inside identifiers in warning text, marking healthy servers as failed, and the sticky error status ignored later "ready" signals.

  - `bos dev` now rebuilds `everything-dev`/`every-plugin` dists when stale (newest source/package.json mtime vs dist entry) instead of skipping whenever dist exists.
  - Plugin error patterns tightened to real compile-failure signals (`ERROR in`, `failed to compile`, `Module not found`, `Cannot find module`) — no more false failures from warning text.
  - A later "ready" signal now clears an earlier "Process failed" status, matching rspack watch-mode recovery.
  - New `suppressPgQueryQueueDeprecation()` (host + api boot): silences pg's once-per-process query-queue deprecation from pg-pool's internal dispatch while re-printing every other process warning (Node's default warning handler is removed first, since it prints even with listeners attached).

- d57b8f4: Fix the tenant publish plane: the apps plugin no longer overrides the registry namespace, so tenant config publishes (including DAO-owned tenants via the Trezu flow) now target the global `dev.everything.near` registry that `bos://` resolution and the host's tenant loader actually read. Previously the wizard wrote configs into a project-local FastKV trie that the host could never resolve.

  Tenant discovery moves to the project database: a new public `GET /tenants/apps` route lists active tenants with their primary hostname and attached geographic node, and the landing-page directory is now powered by it (rows link via their stored binding hostname instead of deriving `slug.gateway`). The wizard's publish re-check reuses the shared `buildRegistryConfigUrl` helper, and a pinned test guards the publish contract against future namespace drift.

- d57b8f4: Fix hardcoded port 3000 in production runtime config causing binding resolver to fail.

  - `buildRuntimeConfig` hardcoded `host.url` and `host.port` to `http://localhost:3000` in production, ignoring `process.env.PORT`. When Railway (or any platform) sets `PORT` to a different value, the HTTP server listened on the correct port but `config.host.url` still pointed at 3000. The binding resolver uses `config.host.url` to fetch `/api/tenants/bindings` from itself, hitting the wrong port and getting 503.
  - Now reads `process.env.PORT` with a fallback to `DEFAULT_HOST_PORT` (3000) for both `hostListeningUrl` and `host.port`.
  - Also fixes Dockerfile `HEALTHCHECK` and `CMD` to use `${PORT:-3000}` so the container probes and starts on the platform-injected port.
  - Removes remote image reference from `railway.toml` so Railway builds from the local Dockerfile instead of pulling a stale prebuilt image.

- d57b8f4: Add --registry flag to bos start, remove dead postinstall from Dockerfile

  - Thread `--registry` override through `resolveRemoteConfigChain` and `fetchPublishedConfig` so `bos start` can override the FastKV registry contract when fetching remote config.
  - Remove `RUN bun run postinstall` from Dockerfile — the script was removed from package.json in a prior commit but the Dockerfile was never updated, causing Docker builds to fail.

- d57b8f4: Fix testnet FastKV registry namespace defaulting to mainnet account

  - Testnet namespace was hardcoded to `dev.everything.near` (a mainnet account) instead of `dev.allthethings.testnet`. Publishing to testnet submitted transactions against the wrong contract.
  - Remove `REGISTRY_FASTKV_*_NAMESPACE` and `REGISTRY_FASTKV_*_URL` env var overrides — URLs and namespaces are now hardcoded constants.
  - Add `--registry` flag to `bos publish`, `bos deploy`, and `bos key generate` to override the FastKV registry contract account at the CLI level.
  - Clean up `plugins/apps` RegistryConfigService to drop the env var fallback, relying on the `registryNamespace` bos.config.json variable.

- d57b8f4: Add a `backcompat` regression test mode (`bun run test:regression:backcompat`) that boots a local host while loading the last published UI/API/plugin bundles via Module Federation, verifying the new host works against existing published bundles. Regression commands (`dev`, `prod`, `backcompat`) now run both HTTP and browser suites each time instead of stopping when the HTTP suite fails.
- d57b8f4: Fix fresh-clone dev flow: commit docker-compose.yml, boot CLI from source, drop postinstall.

  - Commit `docker-compose.yml` (was gitignored and generated only after preflight, creating a chicken-and-egg where `bun run dev` exited before the file was written). Provisions `postgres-api` (5432/api*db) and `postgres-auth` (5433/auth_db); plugins isolate via `plugin*<pluginId>`schemas sharing`api_db`.
  - Add `paths` to `packages/everything-dev/tsconfig.json` mapping `every-plugin` and subpath exports to source files so bun's runtime resolver finds them without pre-built dist. Fresh clones no longer need a manual `bun run --cwd packages/every-plugin build` before `bun run dev`.
  - Remove `postinstall: "bun run types:gen"` from root `package.json` — it was already dead code (`bunfig.toml` sets `ignore-scripts = true`). Gen files are produced on-demand by `bos dev`, `bos build`, and `bun typecheck`.
  - Update `AGENTS.md` Quick Reference to include `docker compose up -d --wait` and document the plugin schema isolation model.

- d57b8f4: Generate `plugins-client.gen.ts` for local auth plugins during `bos types gen`. Previously the per-plugin client types were only written for entries in the `plugins` map, so a vendored local auth plugin importing generated `PluginsClient` types failed typecheck on fresh checkouts (the file existed only as a gitignored local leftover). The generated-files report now also resolves paths from each plugin's `localPath`, so `_template` is reported correctly and the auth plugin's generated file is listed.
- d57b8f4: Local stacks now export the host origin as `BASE_URL` (dev orchestrator env + regression stack env), so the auth plugin's Better Auth instance stops falling back to the hardcoded `http://localhost:3000`. Previously every baseURL-derived URL — invite-email accept links, passkey RP-id derivation, callback URLs — pointed at port 3000 while the stack actually ran on the configured host port, breaking any non-3000 deployment of a local stack.

  Regression test databases also get a DB-level `lock_timeout` (10s): postgres lock waits are unbounded by default, so one lingering transaction could stall every later request touching the same rows for minutes with no error.

- d57b8f4: Post-sign-in redirect loop fix ("Too many redirects" after a successful login). The login page navigated to the redirect target before the refreshed session landed in the query cache, and the authed route guards read that cache via `ensureQueryData`, which returns a stale value immediately — so the guard bounced the just-signed-in user back to `/login`, the login route bounced them forward again, and the two guards ping-ponged past TanStack Router's 20-redirect limit into a root-boundary "Application error". Three fixes:

  - The login page (and the device-pairing claim path) now refresh the session cache **authoritatively** — `getSession({ query: { disableCookieCache: true } })`, since the Better Auth session cookie cache can still serve the pre-sign-in signed-out snapshot for up to 5 minutes — and seed the `["session"]` query before navigating.
  - Route guards (`requireSession`/`requireAdmin`, `_authenticated`, `_admin`) read the session via `queryClient.query()`, which **awaits** the refetch when the cached value is stale instead of trusting it.
  - Banned users no longer ping-pong: the login route skips its authed-visitor redirect for banned sessions, breaking the `/login#banned` ↔ `/dashboard` cycle.

  Covered by router-level regression tests (plugins/auth/ui `login.test.tsx`, ui `auth-guards.test.ts`) and a browser regression in `tests/regression/browser/specs/auth-redirect.spec.ts`.

- d57b8f4: Modernize the ui plugin remote rsbuild configs to environments-based dual-target builds.

  - `plugins/auth/ui` and the core `ui` workspace now use one `rsbuild.config.ts` with `environments: { web, node }`. The `web` environment emits `remoteEntry.js` (client MF remote); the `node` environment emits `dist/ssr/remoteEntry.server.js` (commonjs container for SSR composition). Both load through the official `@module-federation/rsbuild-plugin` — `target: "node"` applies the upstream SSR recipe (node runtime plugin, CJS container, `async-node` chunk loading) instead of hand-rolled rspack config.
  - Shared singleton contracts unify on `createUiSharedDeps` (`react`, `react-dom`, `@orpc/*`, `@tanstack/react-query/router`), so the core ui remote now also enforces strict version identity (previously `strictVersion: false` locally).
  - Client builds of the core `ui` remote and plugin ui remotes emit rspack `crossOriginLoading: "anonymous"`, so async-chunk load errors from cross-origin plugin remotes surface with real detail instead of a masked `Script error.`.
  - Dev keeps two rsbuild dev processes (`--environment web` / `--environment node`): the SSR dev origin must be the artifact root — with one combined dev server the MF runtime anchors the node environment's `publicPath` at the shared origin root and the node chunks resolve onto the web environment's JSONP chunks (`self is not defined`). The dedicated `ui-ssr` / `plugin-ui-ssr:<id>` dev services and `uiSsr` port allocations remain.
  - `packages/everything-dev` federation tests re-encode the shared-instance invariants (one composition instance per process; integrity bumps re-register the remote in place), and the regression browser suite gains a bounded composed-SSR readiness probe (`REGRESSION_SSR_PROBE_TIMEOUT_MS`, default 90s) for early, diagnostic exits when the stack cannot start.

- d57b8f4: Require platform-admin approval for self-service organizations, expose pending and rejected request status, and prevent unapproved organizations from being activated or linked to tenants. Personal signup organizations remain active.

  Block direct member additions before approval and preserve shared organizations when the original requester's account is removed.

  Enforce organization approval through shared authorization middleware and infer organization status in the UI from the auth API contract.

- d57b8f4: Add organization onboarding stations: an owner/admin creates a capped, expiring onboarding code (named after an event) from the org page's new Onboard tab, and displays it as a QR. People scan it with a phone, land on `/onboard`, and join the organization — plus the event's team (find-or-create by event name) — by signing in with a passkey wallet or an existing NEAR wallet. Includes live redemption status (joined list polled every 2s), code revocation, idempotent redemption, and membership-capacity enforcement. Also fixes the stale `development` export condition for `everything-dev/ui/manifest-generator` left by the manifest refactor.
- d57b8f4: Reorganize `plans/` directory: consolidate prototypes under `plans/prototypes/`, group plans into `beta-v2/`, `extensions/`, `infra/`, `offline/`, `v1-current/` subdirectories. Fetch full prototype source from `prototype/route-merging` branch (85 source files). Fold `react-native-migration.md` into `beta-v2/native.md`. Fix TOML/JSON publishing contradiction in composable plan. Mark wayfinder tickets 01 and 02 as resolved, 06 as partially resolved. Rewrite `plans/README.md` index with new structure and ticket status table.
- f151e1b: `bos init` now pins generated child projects to the parent workspace's pnpm (`pnpm@12.10.1`), matching the pnpm 10 → 12 toolchain cut-over; a unit test pins the constant to the root `package.json` `packageManager` field so the two can't drift again. Previously children were pinned to `pnpm@10.20.0`, whose packageManager auto-switch path fails against the new pin.
- d57b8f4: Harden the #119/#120/#121 landing train: `bos login` registers the credential handoff before the browser can reach the callback (fixes a race that silently dropped the credential) and delivers it via loopback POST instead of URL query (the minted API key no longer appears in browser history), `bos publish --wallet` no longer constructs a dummy signing strategy, generated rspack configs skip `withPluginDeploy` when no `bos.config.json` is reachable and reuse the single shared config-path walker, and UI route grafting shallow-copies plugin subtree roots so cached plugin trees can be recomposed under different mounts.
- d57b8f4: Fix dev sessions being unquittable from their own terminal: Bun's TTY stdin never enters flowing mode from a bare `data` listener attach, so with the TUI's raw mode on (ISIG disabled) neither `q` nor Ctrl-C reached the key handler and no SIGINT was generated either. The renderer now resumes stdin after enabling raw mode (and pauses on unmount). Quit-path hygiene rides along: the signal handler delegates to the same shutdown path the TUI uses, emergency kill reuses `reapGroup`, the force-exit re-arm got an honest name, and `l` (export logs) no longer counts toward the quit escalation. New framework regression tests drive a real pty: press `q`, press Ctrl-C, and assert the whole stack dies.
- d57b8f4: Make host/plugin failures visible and stop one failed plugin from taking down the API.

  Production incident: at boot, `proposals`/`votes`/`template` plugins failed their `CREATE SCHEMA IF NOT EXISTS "drizzle"` migration on the shared journal schema (concurrent boot migrations race on `pg_namespace`; `IF NOT EXISTS` is not race-safe). The API plugin then died because its initialize unconditionally called the failed template plugin's client factory (failed plugins get a throwing stub). The host served `/api/*` as 503, so the BindingResolver's self-fetch of `/api/tenants/bindings` failed and every tenant-domain request (e.g. `chicago.citynode.app`) broke, while Railway healthchecks stayed green.

  - API plugin initialize now tolerates failed dependency plugins: the template client is optional and template-backed routes return their existing clean "not included in this deployment" errors instead of crashing the whole API.
  - Journal migration init (`CREATE SCHEMA`/`CREATE TABLE`) is retried with backoff and tolerates duplicate-object/unique-violation races in `api`, `proposals`, `votes`, and the `_template` scaffold (shared `isRetryableMigrationError` predicate in `everything-dev/db`).
  - `/health` now returns a JSON summary (`status`, `api`, `auth`, error detail) instead of hardcoded `OK` — always 200, so Railway healthchecks stay green and the UI keeps serving, but the degraded state is observable.
  - When the API plugin fails to load, the host logs a prominent startup banner listing available/failed plugins and the consequences (all `/api/*` → 503, tenant bindings unavailable), and the `/api/*` 503 stub body now includes the plugin-load error detail.
  - BindingResolver failure handling: HTTP 503 from `/api/tenants/bindings` is reported as "API plugin is not available on this host" with a pointer to `/api/_health`, failures are negative-cached for 10s to avoid refetch storms, and stale bindings are still served when available.
  - Plugin bootstrap errors are never empty again: `unwrapErrorMessage` falls back through error name, `_tag`/JSON, and finally `"unknown error"`, and any plugin declaring a `*_DATABASE_URL` secret now gets a masked DB-URL hint in the failure log (previously auth/API only).

- d57b8f4: Keep proposal, profile, tenant, Thing, and stake views fresh after mutations; preserve the current session when revoking other sessions; and clean up live subscriptions safely. Split complex dashboard, admin, and settings components while preserving workflow state, and improve shared loading, error, accessibility, and bootstrap behavior.

  Sync the shared document and router fallback components into existing child projects alongside the framework router updates.

- d57b8f4: Fix the browser regression teardown stall. Playwright's webServer shutdown hung ~2 minutes after the last test (the stall watchdog hard-exited, failure output never printed) and left the stack alive as port squatters. Two changes in `start-stack.mjs`:

  - Stack output is written to `.bos/logs/regression-<mode>.log` instead of inheriting the webServer's piped stdio — the service tree held playwright's stdout/stderr fds open, so teardown's EOF wait never resolved until the watchdog killed the run. The log rides the existing `.bos/logs/**` failure artifact.
  - SIGTERM/SIGINT now escalate: the signal is forwarded to the child's process group and, if the stack hasn't exited within 5s, the group is SIGKILLed and the runner exits — a wedged graceful shutdown can no longer hold the webServer open (mirrors the dev orchestrator's own force-exit).
  - The dev/start orchestrator gains an orphan watch: when its parent chain is SIGKILLed out from under it (playwright tree-kills the webServer — no signal handler runs), the orchestrator detects the reparenting within 200ms and force-exits, reaping the whole service tree. This also covers shell aborts leaving zombie stacks that poison the next run's ports.

  The stall watchdog's runner snapshot also works on macOS (`free` and GNU `ps --sort` are Linux-only; BSD `ps -axo` fallback).

- d57b8f4: Config resolution rewritten around an explicit ResolutionSession: `openResolution()` / `fromParts()` replace the process-global config cache and its suppress/drain/resume warning protocol. All bos commands now thread the session explicitly; warnings from config resolution print instead of being silently dropped on some paths; `bos dev` with no config fails before the install/build steps instead of after; `--config-path` boots stage artifacts beside the config file; circular `extends` errors are tagged and carry the full chain for both local and remote chains.
- d57b8f4: Security hardening batch (plan 039):

  - Plugin keys are validated at the config boundary (`[a-zA-Z0-9._-]` required) — keys flow into shell invocations and generated TypeScript imports, so a hostile key from a remote/extended runtime config could execute commands or break out of generated code strings. `bos db studio` no longer spawns drizzle-kit through a shell.
  - TLS certificate verification is now ON by default for non-local database connections (`DB_SSL_REJECT_UNAUTHORIZED=false` is the documented opt-out for self-signed deployments).
  - SRI verification fails closed: a fetch failure during verification now throws instead of counting as verified, and a hash computation failure during deploy retries with backoff and then keeps the previous integrity field instead of deleting it from the published config.
  - The exported NEAR publish key file is tightened to mode 0600; `bos key publish` warns loudly when the private key goes to non-interactive stdout (CI logs persist it).
  - Env-sync drift logs mask credentials in `*_DATABASE_URL`/`*_SECRET`/`*_KEY` values.

- d57b8f4: Add self-deployed development docs to AGENTS.md and child project scaffold.

  - Document the independent self-deployment workflow: create a NEAR account via near-cli-rs, generate a publish key with `bos key generate`, set `extends` in `bos.config.json`, `bos publish --deploy`, and run your own Railway host with `BOS_ACCOUNT` + `BOS_GATEWAY` (same gateway, own account).
  - Explain that `BOS_GATEWAY` is the FastKV lookup key, not the DNS domain — keeping the same gateway while using your own account inherits the base platform via `extends` and overrides only what you change.
  - Document subaccount creation setup with near-cli-rs: named account requirement, full access key export, `NEAR_SUB_ACCOUNT_PARENT_KEY` secrets, and `siwn` variable updates.
  - Add a near-cli-rs quick reference table.
  - Include the self-deploy section in the scaffolded child project AGENTS.md template (`bos init`).
  - Add a "Self-Deployed / Tenant Publishing" subsection to the `publish-sync` skill.

- c520871: A failing `getSession` request no longer caches `null` as "signed out" — the session query errors instead, so a transient auth-service outage can't sign the UI out client-side.
- d57b8f4: fix(auth): single authoritative session read path — post-sign-in redirect loop

  All session reads (route guards, the login route's beforeLoad, useQuery
  observers, the post-sign-in refresh) now share one queryFn that always calls
  `getSession({ query: { disableCookieCache: true } })`, so every redirect
  decision sees the same authoritative answer and the login ↔ dashboard
  ping-pong ("Too many redirects") is structurally impossible. The
  post-sign-in refresh (`refreshSessionCache`) overrides staleness so a fresh
  signed-out cache entry written by an observer moments earlier cannot
  short-circuit it. Removed the redundant authed-redirect triggers on the
  login page (component-level `<Navigate>`, loader prefetch), the dead
  `rejectAuthed` guard, and the bootstrap WeakSet bookkeeping in
  `resolveSessionFromCache`. The server-side better-auth session cookie cache
  is disabled outright: it was prod-only (dev and prod behaved differently)
  and delayed revocation/ban visibility for up to its maxAge. The login
  redirect sanitizer now rejects `/login…` targets, closing the last possible
  self-referential redirect loop.

- d57b8f4: Confirm the SIWN auth relayer is in `RelayerEphemeralConfig` ("Ephemeral with settings") mode: a rich-object `relayer` block in `bos.config.json → app.auth.variables.siwn` with `whitelistedContracts`, `maxGasPerTransaction`, and `maxDepositPerTransaction` and no `accountId` / `privateKey`. better-near-auth 1.9.0's `initRelayer` resolves this to an auto-generated ED25519 keypair on first startup, encrypted with `BETTER_AUTH_SECRET` (HKDF-SHA256 → AES-256-GCM) and persisted in the `relayerKey` table.

  The vestigial `NEAR_RELAYER_PRIVATE_KEY` line is removed from `.env.example` in favor of an inline comment pointing operators at `/admin/relayer` (which surfaces a "needs funding" prompt using `getRelayerInfo().enabled === false` once the auto-generated implicit account has zero balance). Operators funding the implicit account via `authClient.near.getNearClient().transfer()` enables relay without ever leaving the existing ephemeral-mode config.

  AGENTS.md gains a "SIWN Auth Relayer" subsection under "Common Patterns" documenting the operational rules (funding flow, parent-key requirement for sub-account creation, why the implicit relayer account can't own sub-accounts, and the path back to `RelayerExplicitConfig` if a named-account relayer is needed).

- d57b8f4: Fix misleading "UI-SSR running" dashboard line when SSR is off.

  - Gate the `ui-ssr` service descriptor in `buildServiceDescriptors` on `runtimeConfig.ui.ssrUrl` being truthy, aligning the planner path with `service-descriptor.ts` which already correctly omits `ui-ssr` when `ssr === false`.
  - Previously the planner always added `ui-ssr` to `orchestrator.packages` (it only checked `resolvedPorts.uiSsr`, which is always allocated), so the orchestrator treated the missing descriptor as a "Remote" service and immediately marked it `ready` — printing "UI-SSR running" even though no `bun run dev:ssr` process was spawned.

- c520871: Parse the authored `staging` block through `BosConfigInputSchema` — previously the interface accepted it but the schema dropped it during validation.
- d57b8f4: Publish stamps the built MF container name into folder-form plugin ui slots (`app.<id>.ui.name` / `plugins.<id>.ui.name`) so fully-remote boots register the remote under the name the deployed container actually exposes. Previously the config carried only the authored fallback name (e.g. `auth-ui`), which broke SSR compose against CDN bundles built as `_everything_dev_auth_plugin`.
- d57b8f4: Start-command regression stack fixes (the deployment-image path):

  - The regression container's fixture config now injects the auth plugin's `baseUrl` variable (`http://localhost:<port>`, the bos start ingress). The domain-derived `https://` baseURL made better-auth set Secure cookies that no http client (Go jar or browser) can send back: sign-in succeeded but every session-bearing request 401'd. The config variable wins over the host's domain derivation by construction — production stacks are untouched.
  - The auth plugin's better-auth core rate limiter can be disabled via `BETTER_AUTH_RATE_LIMIT_DISABLED=1` — production defaults it on with a single shared per-path bucket when no client IP is resolvable, which the regression suite's `/api/auth/*` traffic trips within seconds.
  - The regression container now forwards the harness's `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `BODY_LIMIT_MAX` into the image — without them the host's middlewares ran defaults, so the oversized-body pin got a 404 (no procedure match for a 70KB text body) instead of 413, and the rate-limit burst never saw a 429.

- d57b8f4: fix(everything-dev): keep localhost origins in local production starts

  The production-start localhost-origin purge now fires only for registry-fetched
  starts (`BOS_ACCOUNT`/`BOS_GATEWAY` — real deployments, where a localhost
  `CORS_ORIGIN`/`BASE_URL` is a stray dev leftover). Explicit `--config-path`
  starts (the regression harness) and bare local `bos start` runs keep their
  injected origins: the in-process host's auth seam reads them from
  `process.env`, and an https fallback there made better-auth issue Secure
  cookies no http client could send back — sign-in succeeded but every
  session-bearing request 401'd, and untrusted origins rejected writes with
  `INVALID_ORIGIN`.

- d57b8f4: Fix the start-command stack mounting auth as a generic plugin: `normalizeToNodes`'s plugins loop overwrote the dedicated `auth` DAG node (kind `"auth"`) with `kind:"plugin"` whenever the runtime config carried the auth mirror — which start/production resolution always does (the mirror's url is filled; in dev it stays empty, so dev was safe only by accident). With the node mistyped, the host never assigned `plugins.auth`/`authClient`, so `/api/auth/*` was never mounted: every better-auth route (anonymous sign-in, get-session, organizations, api keys) returned plain-text 404, and the body-limit/rate-limit regression tests cascaded. The plugins loop now skips the auth mirror — the same rule the host's plugin loading and the service descriptors already apply.
- d57b8f4: Per-PUT retry and 4-way concurrency for bundle storage; storage timeout hint fires for all 408s.

  - **Per-object retry** (`api`): `aws4fetch` signs and sends but never retries — one keep-alive reset over a slow uplink killed entire multi-hundred-file bundle batches (`fetch failed` mid-sequence, after earlier files had already PUT successfully). `S3StorageClient.put/get` now run through a retry helper (3 attempts, 250ms/500ms backoff) that retries transient failures — network errors (undici's `fetch failed`, with the `cause` code surfaced, e.g. `fetch failed (ECONNRESET)`) and 429/5xx responses — and fails fast on definitive rejections (401/403) with the R2 response body included.
  - **4-way PUT concurrency** (`api`): the storage route uploads files through `Effect.forEach(..., { concurrency: 4 })` instead of sequentially — 736 sequential round-trips were minutes of pure latency.
  - **Timeout hint** (`everything-dev`): the `BOS_STORAGE_UPLOAD_TIMEOUT_MS` hint now fires for the storage route's own 408 body ("Bundle upload timed out"), not just the general API timeout's "Request timeout".
  - **Env docs**: `.env.example` regains the ADR 0020 storage section (BOS*STORAGE*\* / CDN deploy vars) plus the new `BOS_STORAGE_UPLOAD_TIMEOUT_MS`.

- d57b8f4: Fix bundle-upload timeouts that broke CDN publishes mid-deploy.

  - **Storage upload timeout**: `/api/storage/bundles` is exempt from the general 30s API timeout and gets its own much longer budget (`BOS_STORAGE_UPLOAD_TIMEOUT_MS`, default 10 min). Large batched uploads (receiving + SRI-hashing + storing the `ui` dist) routinely exceeded 30s, so the host aborted mid-upload with `500 {"error":"Request timeout"}` and the publish died after partially re-uploading workspaces — leaving the CDN serving bytes that no longer matched the published config's SRI hashes.
  - **Upload retries**: `uploadBundle` retries up to 3 attempts with backoff on retryable failures (network errors, 408/429/5xx); non-retryable statuses (401/403/413) fail immediately as before. Retries are idempotent (the storage route overwrites by workspace+path and recomputes SRI server-side). A timeout failure now hints at `BOS_STORAGE_UPLOAD_TIMEOUT_MS`.
  - **Build warning**: `loadAppDescriptorConfig`'s runtime-resolved dynamic import is marked `webpackIgnore` so bundlers stop warning "Critical dependency: the request of a dependency is an expression".

- ed70808: Two-database contract: production deployments now need only `AUTH_DATABASE_URL` and `API_DATABASE_URL`; plugin `*_DATABASE_URL` secrets fall back to the shared API database (per-plugin tables isolate in `plugin_<slug>` schemas). Explicit per-plugin values still win.

  - `bos start` no longer manufactures `.env`/`.env.example`/`.env.test` at boot — the production container previously generated a dev-convention `.env` (localhost Postgres URLs) and dotenv-loaded it, feeding plugin DB secrets unreachable URLs (`ECONNREFUSED`). `bos start` only loads an operator-provided `.env`; `bos dev`/`bos init` keep the bootstrap.
  - Plugin `*_DATABASE_URL` secrets missing from the host environment resolve to `API_DATABASE_URL` (host plugin composition).
  - Generated `.env.example` omits plugin database secrets (they are fallback-covered); `.env.test` keeps explicit test-database values for isolation.

- 8a06f6b: Introduce typed Effect errors across host, CLI, and plugin runtimes. `every-plugin`'s `Plugin.initialize` contract now types its layer error channel as `Error` and its failure channel as `PluginRuntimeError` (mapped via `toPluginRuntimeError`), and `PluginRuntimeError` exposes a readable message. `everything-dev` gains exported `OrchestratorError` and `encodeRuntimeConfig` — `BOS_RUNTIME_CONFIG` is now schema-encoded with undefined fields omitted (undefined array entries become null) instead of raw `JSON.stringify` — plus tagged error conversions in migrations, preflight, integrity, near-cli, and storage-upload, and schema-validated migration journal loading.
- f9d2dce: Trim the core ui's declared MF surface to consumed exposes (drop `./providers` and `./hooks`), construct the core-only tree on the client when a deployment carries no compose payload or a malformed one (plugin-free CSR apps no longer crash on "no route tree"), and correct ownership headers. The ui globals ambient file is trimmed to the rsbuild types reference.
- d57b8f4: Make `app.host.production` optional in the resolved-config schema (ADR 0005 — deploy state, absent until the first publish writes it). This unblocks runtimes authored via `bos.app.ts` without a committed `bos.config.json`: the descriptor-to-config conversion fills `development` only, and deploy legs materialize `production` on first publish.
- d57b8f4: Verification & speed (plan 040): the root `bun run test` chain now includes the framework suites (`test:framework` — everything-dev + every-plugin), so a green root run actually exercises the CLI package. `bos dev`/`bos start` no longer block service spawn on the outdated-packages check (npm registry + FastKV round trips, up to ~10s with retries) — the warning prints late via stderr instead (TTY-preserving). The two config test suites stub their network boundary (`http-client`/`fastkv`/`api-contract`) instead of doing real DNS-resolution retries (~15s saved per run, environment-independent).
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [95261fe]
- Updated dependencies [c520871]
- Updated dependencies [4d8efd1]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
- Updated dependencies [c520871]
- Updated dependencies [9191ab3]
- Updated dependencies [4d8efd1]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f151e1b]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f9d2dce]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [784fcad]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [d57b8f4]
- Updated dependencies [f5f1a5f]
- Updated dependencies [f5f1a5f]
- Updated dependencies [d57b8f4]
- Updated dependencies [c23dfb6]
- Updated dependencies [ed70808]
- Updated dependencies [8a06f6b]
- Updated dependencies [f9d2dce]
- Updated dependencies [f9d2dce]
- Updated dependencies [9191ab3]
- Updated dependencies [d57b8f4]
  - every-plugin@3.0.0-rc.0
  - better-near-auth@2.0.0-rc.0

## 1.53.2

### Patch Changes

- ad6c462: Fix stale auth type name in type generation by replacing the hard-coded re-export list in `auth-types.gen.ts` with `export type *`. New types added to the auth plugin's `auth-export.ts` now flow through automatically without generator changes, preventing the class of `TS2724` errors caused by stale type names.
- ad6c462: Fix `Deploy` and `Staging` workflows failing with `! [rejected] main -> main (fetch first)` when remote `main` (or `staging`) advances during the long deploy window. The final push step now `fetch` + `rebase` against the remote ref before pushing, retries up to 5 times with exponential backoff, and exits cleanly when there's nothing to push after rebase. This eliminates races with the `Release` workflow's auto-merged `chore: version packages` PR, manual `workflow_dispatch` triggers, Renovate, and human commits landing during deploy.

## 1.53.1

### Patch Changes

- 380f907: Fix stale auth type name in type generation by replacing the hard-coded re-export list in `auth-types.gen.ts` with `export type *`. New types added to the auth plugin's `auth-export.ts` now flow through automatically without generator changes, preventing the class of `TS2724` errors caused by stale type names.

## 1.53.0

### Minor Changes

- ada1cd2: Add a `connectSrc` field to plugin config so plugins can whitelist external WebSocket/HTTPS origins in the host CSP.

  - Plugins can declare `connectSrc: ["wss://relay.damus.io"]` in `bos.config.json`; the host merges these into the CSP `connect-src` directive in both dev and prod
  - `connectSrc` arrays are unioned across `extends` chains (like `secrets`)
  - The field flows through `RuntimePluginConfig`, DAG nodes, and tenant plugin overrides
  - Removes the need for dev-only proxy workarounds (e.g. `relay-proxy.mjs`) to reach third-party relays in production

- ada1cd2: Add tenant lifecycle status to the runtime and gate resolution on it.

  - Add an optional `status` field (`active` | `suspended` | `pending_deletion`) to `BosConfigInput` so it survives config parsing
  - Host `resolveRequestRuntime()` now reads the tenant's published config status and rejects suspended tenants (503) and pending-deletion tenants (410) before serving
  - Tenant suspend/reactivate/delete republish the tenant config with the matching status so the host picks it up without an API round-trip

### Patch Changes

- 25f6d08: `bos dev` now generates `.env.example` and `docker-compose.yml` via the full runtime secret set (`writeGeneratedInfra`) instead of only auto-generated database/redis URLs and `CORS_ORIGIN`. This fixes regenerated files silently dropping host/API/auth/plugin secrets (e.g. `BETTER_AUTH_SECRET`, `CSP_STRICT`, GitHub/Google client secrets) that remain declared in `bos.config.json`.
- ada1cd2: Generate optional `PluginsClient` properties for unresolved `api.dependsOn` plugins.

  When `api.dependsOn` references a plugin that isn't registered in the configuration,
  the generated `PluginsClient` type now includes an optional property with a generic
  `ClientFactory<AnyContractRouter>` signature, instead of silently dropping the
  dependency. This allows the API entry point to use optional chaining
  (`plugins.pluginKey?.()`) without type errors.

  Previously, an unresolved dependency caused `PluginsClient` to be typed as
  `Record<string, never>`, which combined with `noUncheckedIndexedAccess: true` in
  the API's tsconfig produced TS18048/TS2722 errors on any direct access to the
  dependency.

## 1.52.0

### Minor Changes

- e574161: Improve `bos sync` and `bos upgrade` with conflict detection, script cleanup, `--json` flag, and upgrade ordering fix

  - **Conflict detection**: Snapshot-based 3-way hash comparison (local vs source vs snapshot) in sync. Files modified by both user and template are backed up to `.bos/sync-backup/` and overwritten with the template version. User-only changes are respected (left alone). Output includes a "For AI agents" block with version delta, conflict count, backup path, upstream PR link, and intent skills reference.
  - **`--json` flag**: `bos sync --json` and `bos upgrade --json` output machine-parseable JSON for CI integration.
  - **Upgrade ordering fix**: Install new packages BEFORE running migrations by re-executing `bos upgrade --migrations-only --json` from the newly installed package, ensuring migration code runs with the latest version.
  - **Script exclusion**: Parent-only scripts (those not in `buildChildRootScripts`) are automatically cleaned from child project `package.json` during `personalizeConfig` and `migrateChildRootPackageJson`. Self-maintaining via `getParentOnlyScriptKeys()`.
  - **Child root scripts cleaned up**: `node_modules/.bin/bos` replaced with `bos` shorthand. `test` script uses `--if-present` per workspace for flexible test execution when workspaces may or may not have tests.
  - **Dead code removed**: Removed `--force` messaging, stale "Review changes" blocks from sync/upgrade output.
  - **Root app support**: `bos upgrade` now skips sync and parent plugin discovery when there is no `extends` field, instead of silently swallowing a sync error. Framework updates and migrations still run normally in root apps.
  - **No double banner**: Child processes (`bos types gen`, re-exec upgrade) now set `BOS_NO_BANNER=1` to suppress the banner, preventing duplicate output and fixing a latent JSON corruption bug in the re-exec path. The banner is gated on `process.env.BOS_NO_BANNER` being unset.
  - **Safer cleanups**: Removed `.github/renovate.json` from obsolete files list (should be preserved). Changed "Removed" label to "Migrated" in CLI output since the list includes both rewritten and actually-deleted files.
  - **Bug fixes**: Fixed `changelogUrl` always being `undefined` in non-dry-run upgrade results. Fixed `runTypesGen` being called twice. Fixed `skipped` array never being populated in sync results. Removed unused `sharedSync` variable and `existsSync` import.

- 7c71c87: Move to dependency-graph-based plugin composition with manifest stacking and per-plugin type generation

  - **Dependency DAG**: New `dag.ts` module with `normalizeToNodes()`, `topologicalSort()`, `buildDependencyDAG()`, `mergeManifestNodes()`, `getDependenciesForNode()`, and `getSingletonKey()`. API implicitly depends on all non-ui siblings unless `dependsOn` is explicit.
  - **Manifest stacking (one level deep)**: `buildRuntimeConfig` now fetches the API plugin manifest when remote, discovers sub-plugins with secrets/variables, and merges them into the runtime config. Config-declared plugins override manifest-discovered ones.
  - **Per-plugin type generation**: `writeGeneratedFiles()` now generates per-plugin `plugins-client.gen.ts` files in `plugins/{key}/src/` when `dependsOn` is declared, and `plugins-types.gen.ts` is filtered by `apiDependsOn`.
  - **Host DAG-based loading**: `plugins.ts` loads auth, plugins, and API in DAG order with a singleton cache, using `getDependenciesForNode` to wire per-plugin client contexts. Removed `loadedPluginKeys.unshift("api")` hack.
  - **Node-based runtime config**: `RuntimeConfigSchema` gains a `nodes` field populated by `buildRuntimeConfig`, enabling the host to reason about the plugin graph directly.
  - **Async `buildRuntimeConfig`**: Now returns `Promise<RuntimeConfig>` — all callers updated.

- e574161: Improve `bos types gen` with `--remote-plugins` flag, cleaner output, and local paths

  - **`--remote-plugins` flag**: `bos types gen --remote-plugins auth,apps` forces specified plugins to fetch contract types remotely, matching `bos dev --remote-plugins` behavior. The flag is passed through from `runTypesGen` in init.ts, so `bos sync` and `bos upgrade` also benefit.
  - **Cleaner output**: Replaced misleading "Mode: local|remote" (which only reflected the API source) with a "Contract sources:" section that shows each plugin's actual source. Output is now organized as "Written:" (generated files) and "Contract sources:" (per-plugin remote/local status).
  - **Local paths shown**: Local contract sources now display their relative project path (e.g., `api local (api)`, `apps local (plugins/apps)`) instead of just "local".
  - **Removed unused `source` field**: The `source` field was removed from `TypesGenResultSchema` and the handler since it was redundant — each contract source now reports its own status individually.

## 1.51.7

### Patch Changes

- 3be7608: Add PluginIdTag to Effect context for reliable plugin slug derivation in production

  - `every-plugin`: Exports `PluginIdTag` (`Context.Tag<string>`) and provides it via `Effect.provideService` during plugin initialization
  - `api`: Replaces `getMigrationSlug(import.meta.dirname)` with `yield* PluginIdTag` so the slug resolves correctly in Module Federation remotes
  - `everything-dev`: Adds `pg` to dependencies and `neverBundle` to fix module resolution in child projects running `bos db doctor`/`repair`

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
