# everything-dev

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
