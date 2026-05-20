# @everything-dev/registry-plugin

## 1.4.0

### Minor Changes

- 1adfdee: Support account-relative tenant resolution on shared hosts so subdomains derive from the active runtime account instead of `label.near`, and allow nested tenant labels in the resolver and tests. Expose runtime lineage in the apps registry by deriving parent, root, depth, and extendsChain from `extends`, and add registry list filters for parent and root traversal.

## 1.3.1

### Patch Changes

- ffa8200: Catalog-ify rspack/rsbuild packages and propagate via bos upgrade/sync

  - Add @rspack/core, @rspack/cli, @rsbuild/core, @rsbuild/plugin-react to root package.json catalog
  - Convert all workspace package.json rspack/rsbuild deps from version ranges to catalog: refs
  - Change every-plugin @rspack/core peerDep from exact 1.7.4 to range ^1.7.4
  - Add CATALOG_TOOL_PACKAGES to manifest-normalizer for catalog: conversion during init/sync
  - Extend bos upgrade to also bump catalog tool packages to latest npm versions
  - Extend bos status to report catalog tool package versions

## 1.3.0

### Minor Changes

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

## 1.2.4

### Patch Changes

- b193ad6: Fix `reqHeaders` runtime type to be a real `Headers` instance instead of `Record<string, string>`, preventing `TypeError: undefined is not a function` when calling `.get()` in plugin handlers

## 1.2.3

### Patch Changes

- 13f68ff: Inject `getRawBody` and `reqHeaders` into oRPC handler context so plugins can verify webhook signatures

  - Host session middleware now clones the request body before oRPC consumes it, exposing `getRawBody()` in context for raw body access
  - Dev server middleware also injects `reqHeaders` and `getRawBody` (previously passed `context: {}`)
  - API, projects, registry, and template plugins declare `getRawBody` in their context schemas
  - API plugin `reqHeaders` type changed from `z.custom<Record<string, string>>()` to `z.record(z.string(), z.string())` for proper runtime validation

## 1.2.2

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

## 1.2.1

### Patch Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

## 1.2.0

### Minor Changes

- c0452e7: Renamed `productionIntegrity` to `integrity` across all schemas, build configs, and `bos.config.json`. Added `name` and `version` fields to `BosPluginRef`. Enhanced `bos plugin add` with `bos://account/plugins/name` registry resolution, manifest validation, and automatic integrity computation. Enhanced `bos plugin publish` with manifest validation, integrity computation, and FastKV plugin registry writes. Added generic KV routes (`kvGet`, `kvList`, `kvPrepareWrite`, `kvRelayWrite`) to the registry plugin.

### Patch Changes

- 368c872: Improve plugin lifecycle cleanup, add additionalExports, and share BosConfigInput

  Plugin shutdown now logs warnings instead of silently swallowing errors. DB layers use Effect acquireRelease for proper connection cleanup. Build system supports additionalExports for bundling extra type files. BosConfigInput is now exported from everything-dev/types for shared use. Registry plugin validates private key format before creating relay clients.

## 1.1.0

### Minor Changes

- 4efd2db: ## Extract business logic into plugins

  ### Breaking changes (api)

  All business routes have been removed from the `api` package. The API is now a thin structural shell with only health and error routes:

  - **Removed**: `listRegistryApps`, `getRegistryApp`, `getRegistryAppsByAccount`, `getRegistryAppByHost`, `getRegistryStatus`, `prepareRegistryMetadataWrite`, `relayRegistryMetadataWrite` (moved to `plugins/registry/`)
  - **Removed**: `listKeys`, `getValue`, `setValue`, `deleteKey` (moved to `plugins/projects/`)
  - **Removed**: `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject`, `listProjectApps`, `linkAppToProject`, `unlinkAppFromProject`, `listProjectsForApp` (moved to `plugins/projects/`)
  - **Removed**: `listApiKeys`, `createApiKey`, `deleteApiKey` (moved to `plugins/projects/`)
  - **Removed**: `listOrgMembers`, `listOrgInvitations`, `cancelInvitation`, `resendInvitation` (moved to `plugins/projects/`)
  - **Kept**: `ping`, `authHealth`, `publicError`, `protectedError`
  - **Kept**: `requireAuth`, `requireNearAccount`, `requireOrgRole` middleware (duplicated in plugins)

  ### New: registry plugin (`@everything-dev/registry-plugin`)

  FastKV app discovery, metadata publish/relay. No database required.

  - All registry routes from the API are now under `apiClient.registry.*`
  - Configuration via `REGISTRY_RELAY_*` secrets and optional `registryNamespace` variable

  ### New: projects plugin (`@everything-dev/projects-plugin`)

  Projects CRUD, KV store, org management, API keys. SQLite via libsql.

  - All projects/KV/org/API key routes from the API are now under `apiClient.projects.*`
  - Configuration via `PROJECTS_DATABASE_URL` and `PROJECTS_DATABASE_AUTH_TOKEN` secrets

  ### UI changes

  Stale route files for organizations, keys, apps, and settings pages were removed. Project pages (detail, list, new) were later restored to work with the namespaced projects plugin client.

  All `apiClient` calls to business routes must now use namespaced access:

  - `apiClient.listRegistryApps()` → `apiClient.registry.listRegistryApps()`
  - `apiClient.getProject()` → `apiClient.projects.getProject()`
  - `apiClient.listKeys()` → `apiClient.projects.listKeys()`
  - etc.

### Patch Changes

- 96a492e: Add SRI integrity hashes to plugin deployments

  Plugin rspack configs now compute SHA-384 integrity hashes on deploy and write `productionIntegrity` to `bos.config.json`, matching the existing behavior of `api`, `ui`, and `host` packages.
