# host

## 1.5.13

### Patch Changes

- cd7692f: Strengthen the generated auth surface and remove duplicate client facades so downstream packages rely on the canonical typed auth client.
- Updated dependencies [cd7692f]
  - every-plugin@2.5.8

## 1.5.12

### Patch Changes

- e2b4b85: Remove host/api/ui/plugins source from Docker image (loaded remotely at runtime). Remove deprecated `GATEWAY_DOMAIN` environment variable in favor of consistent `BOS_GATEWAY`.

## 1.5.11

### Patch Changes

- 6189953: Compile CLI to standalone binary in Dockerfile for faster cold starts. Remove deprecated `GATEWAY_DOMAIN` environment variable in favor of consistent `BOS_GATEWAY`.
- b193ad6: Fix `reqHeaders` runtime type to be a real `Headers` instance instead of `Record<string, string>`, preventing `TypeError: undefined is not a function` when calling `.get()` in plugin handlers
- Updated dependencies [b193ad6]
  - every-plugin@2.5.7

## 1.5.10

### Patch Changes

- 3a875e2: Fix OpenAPI spec blank page (CSP blocks CDN scripts), host assets 403, and add auth/plugin status to health endpoint

## 1.5.9

### Patch Changes

- 6822f5e: Fix OpenAPI spec page showing blank white screen, add auth/plugin status to health endpoint, and serve host assets locally instead of proxying to UI CDN

## 1.5.8

### Patch Changes

- ba974d4: Fix OpenAPI spec page showing blank white screen and add auth/plugin status to health endpoint
- 05c9fe2: Fix changeset CI errors: replace catalog: protocol for every-plugin dependency so changesets can resolve versions

## 1.5.7

### Patch Changes

- 13f68ff: Inject `getRawBody` and `reqHeaders` into oRPC handler context so plugins can verify webhook signatures

  - Host session middleware now clones the request body before oRPC consumes it, exposing `getRawBody()` in context for raw body access
  - Dev server middleware also injects `reqHeaders` and `getRawBody` (previously passed `context: {}`)
  - API, projects, registry, and template plugins declare `getRawBody` in their context schemas
  - API plugin `reqHeaders` type changed from `z.custom<Record<string, string>>()` to `z.record(z.string(), z.string())` for proper runtime validation

## 1.5.6

### Patch Changes

- 369c59b: Remove redundant auth plugin variables from `bos.config.json` and inject them at runtime instead.

  - **`host/src/services/plugins.ts`**: Added `baseVariables` parameter to `loadPluginEntry` so runtime-derived values can be merged before explicit `variables` from `bos.config.json`. When loading the auth plugin, the host now injects `account` (from `config.account`) and `domain` (from `config.domain`, defaulting to `"localhost:3000"` in development) as base variables. Explicit values in `bos.config.json` still take precedence if present.

  - **`bos.config.json`**: Removed the `app.auth.variables` block. `account`, `hostUrl`, and `uiUrl` are no longer required here since the host provides `account` and `domain` automatically at plugin initialization time.

- ddb9952: Extract auth plugin from monorepo and remove `BETTER_AUTH_URL` env dependency.

  - **Deleted `plugins/auth/`**: The auth plugin is now maintained as an external package and loaded at runtime via Module Federation. The `app.auth` entry in `bos.config.json` remains intact for runtime loading.

  - **`host/src/services/plugins.ts`**: Added `normalizeDomain(domain, env)` helper that:

    - Returns as-is if the domain already has `http://` or `https://`
    - Prepends `http://` for `localhost` / `127.0.0.1` in development
    - Prepends `https://` for everything else
    - Applied to `domain` and `hostUrl` base variables when loading the auth plugin.

  - **Removed `BETTER_AUTH_URL`**: Dropped from `.env.example` and `packages/everything-dev/src/plugin.ts` env generation. The auth plugin now derives its base URL from the normalized `hostUrl` variable passed by the host at initialization time.

## 1.5.5

### Patch Changes

- 543c595: Relaxed CORS origin check to allow any `https://` origin while still respecting `CORS_ORIGIN` for explicit allow-listing. Added `frameSrc` to the Content Security Policy to permit external `https:` frames, fixing blocked wallet iframe loads.

## 1.5.4

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

## 1.5.3

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

## 1.5.2

### Patch Changes

- f185a6c: Remove `@opentelemetry/api` resolve.fallback stub.

  The package is now a direct dependency, so the `false` fallback workaround is no longer needed. Bundlers will resolve it normally.

## 1.5.1

### Patch Changes

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

## 1.5.0

### Minor Changes

- e53af6e: Add CSP with feature flag, integrity registry, on-chain attestation, and safe plugin client factory

  CSP: Add `CSP_STRICT` const (default false) that toggles between relaxed mode (`'unsafe-inline'` + `'unsafe-eval'`) and strict mode (nonce + `'strict-dynamic'`). Relaxed mode is the default because Module Federation requires `'unsafe-eval'`, making strict inline script enforcement moot. All other CSP directives (object-src, base-uri, frame-ancestors, connect-src, etc.) remain enforced regardless of mode. When strict mode is enabled, nonces are injected into HTML script tags and the runtime config.

  Integrity: Add `IntegrityRegistry` class for SRI hash tracking, `installIntegrityFetchHook` for MF lifecycle fetch interception, `verifyConfigAgainstChain` for on-chain attestation checks, and `startIntegrityMonitor` for periodic background re-verification.

  Safety: Wrap plugin client factories with `createSafeClientFactory` to prevent arbitrary context injection. Merge CSP headers into SSR responses.

### Patch Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds
- 34207e4: Reorganize dev port assignments: host=3000, api=3001, auth=3002, ui=3003, ui-ssr=3004, plugins=3010+

  Fix dev TUI display: host always shows "running" with port, remote non-host services show "loaded" without port. Strip ANSI codes from log files, only tag stderr as [ERR] when content is actually error-like, and replace Effect.logInfo with console.log in host logger for clean output.

## 1.4.0

### Minor Changes

- ab0a308: Move auth from plugin to app-level infrastructure with oRPC contract generation

  Auth is now `app.auth` in bos.config.json instead of `plugins.auth`. The host loads the auth plugin as Phase 0 (app-level infrastructure) before other plugins. Session resolution and auth HTTP handler are provided through the auth plugin's oRPC client and initialized context, eliminating direct Better Auth coupling in the host. The `syncApiContractBridge` now generates typed auth contract clients in `api/src/plugins-client.gen.ts` and `ui/src/api-contract.gen.ts`, enabling plugins to call auth routes via `services.plugins.auth()` instead of importing the raw `Auth` type.

- 7c62044: Upgrade better-auth to 1.6.9, mature auth plugin, and add auth orchestration

  Auth plugin now uses Drizzle migrations with virtual:drizzle-migrations, Effect acquireRelease for DB lifecycle, and requires BETTER_AUTH_SECRET. Fixes API key and invitation method shapes for better-auth 1.6.9. The everything-dev CLI orchestrates auth as a first-class dev process. Host replaces Deferred with FiberHandle and resets federation state on shutdown.

- c0452e7: Renamed `productionIntegrity` to `integrity` across all schemas, build configs, and `bos.config.json`. Added `name` and `version` fields to `BosPluginRef`. Enhanced `bos plugin add` with `bos://account/plugins/name` registry resolution, manifest validation, and automatic integrity computation. Enhanced `bos plugin publish` with manifest validation, integrity computation, and FastKV plugin registry writes. Added generic KV routes (`kvGet`, `kvList`, `kvPrepareWrite`, `kvRelayWrite`) to the registry plugin.
- c29e058: Migrate auth from plugin to app-level infrastructure. Host mounts only the raw Better Auth handler; authClient is injected separately from pluginsClient. Plugins receive auth context per-request, not via injected clients. Projects plugin cleaned of auth-proxying routes. Deleted every-plugin/context.ts.

### Patch Changes

- 0dc8772: Fix host crash when accessing auth plugin initialized context
- 39588a1: Remove dead code: bootstrap script, drizzle/database infrastructure, and unused dependencies

  The host no longer has a local database — auth is handled by a runtime-loaded plugin. Removed bootstrap.ts (superseded by orchestrator's spawnRemoteHost), drizzle.config.ts (schema directory already deleted), DrizzleORMMigrations rspack plugin, $apiClient global declaration, and 11 unused dependencies (drizzle-orm, drizzle-kit, better-auth, better-near-auth, @libsql/client, @proj-airi/unplugin-drizzle-orm-migrations, @t3-oss/env-core, @fastnear/near-connect, web-vitals, @tanstack/react-query, @tanstack/react-router). Cleaned up Dockerfile and .env.example accordingly.

## 1.3.2

### Patch Changes

- 3627dd8: Fix production deploy EACCES errors: appuser now owns /app, /app/data, and .bos directories so runtime file creation (database.db, logs, pids) works correctly in the Docker container

## 1.3.1

### Patch Changes

- aeab5ce: Remove demo routes and fix plugin routing. API shell now only exposes `ping` and `authHealth` (with `requireAuth` middleware). Plugin-specific routes are registered before the base API catch-all in Hono, fixing 404s on `/api/rpc/{plugin}/*`. OpenAPI spec includes the current domain as an available server.

## 1.3.0

### Minor Changes

- b666191: Restructure Docker build and release pipeline

  - **Multi-stage Docker build** excludes `packages/` from the final image. The builder stage resolves `workspace:*` refs to npm versions (via `scripts/resolve-workspace-refs.ts`), installs from npm, then the final stage copies only app code + node_modules.
  - **Release pipeline** is now a single sequential job: npm publish gates Zephyr deploy and Docker build. If npm publish fails, nothing else runs.
  - **Start command** uses `bos start` (binary from npm) instead of `bun packages/everything-dev/cli.js`. Account and domain are read from `bos.config.json`.
  - **`everything-dev` and `every-plugin`** moved to `dependencies` in root `package.json` (runtime deps in Docker).
  - **`docker.yml`** is now `workflow_dispatch` only — the release workflow builds Docker inline.

## 1.2.0

### Minor Changes

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

### Patch Changes

- 96a492e: Fix Docker build for nested workspaces

  Replace broken `COPY */package.json ./*/` with `COPY . .` before `bun install`, so nested workspace directories (`plugins/*/`, `packages/*/`) are present when Bun resolves workspaces. Fixes preview PR Docker builds failing with "Workspace not found".

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

## 1.1.1

### Patch Changes

- 1cea1e1: Fix mixed content errors when behind reverse proxy (Railway, etc.)

  Added support for `X-Forwarded-Proto` and `X-Forwarded-Host` headers to correctly determine the request URL when the server is behind a reverse proxy. This fixes mixed content errors where HTTPS pages were making HTTP API requests.

  Also added `secureHeaders` middleware for additional security headers (X-Content-Type-Options, X-Frame-Options, etc.).

## 1.1.0

### Minor Changes

- 2c93dbb: Multi-tenant organization support with Better Auth integration

  - Added Better Auth organization plugin with teams support
  - Implemented all authentication methods: NEAR, email/password, phone OTP, passkey, anonymous
  - Personal organization auto-created for every non-anonymous user
  - Organization management UI: browse, create, switch, invite members
  - Real invitation flow with email notifications
  - Dev-preview email/SMS transport (logs to .dev-preview/ directory)
  - Account settings page for managing auth methods and security
  - Removed placeholder org RPCs - now using Better Auth directly
  - Added API key plugin support
  - Updated milestone-1 documentation

### Patch Changes

- 44393e7: Fix authentication flow in host program with proper session handling and proxy test coverage
- 44393e7: Add plugin support with improved module federation service, shared dependencies handling, and auth client integration
- 44393e7: Add security hardening with Dependabot configuration, SECURITY.md policy, and axios vulnerability mitigation
- 9cb973d: Abstract UI runtime into everything-dev package

  - Moved router creation, SSR rendering, and hydration into everything-dev/ui
  - Split package exports into ./ui/client (browser-safe) and ./ui/server (SSR)
  - Added networkId derivation from account suffix (testnet/mainnet)
  - Created canonical ui/src/app.ts barrel for apiClient, authClient, runtime helpers
  - Deleted ui/src/remote/\* indirection layer
  - Added API contract manifest with checksum for type sync
  - Added everything-dev types sync CLI command
