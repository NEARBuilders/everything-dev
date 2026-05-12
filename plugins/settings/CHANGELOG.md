# @every-plugin/template

## 1.1.0

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

## 1.0.4

### Patch Changes

- b193ad6: Fix `reqHeaders` runtime type to be a real `Headers` instance instead of `Record<string, string>`, preventing `TypeError: undefined is not a function` when calling `.get()` in plugin handlers

## 1.0.3

### Patch Changes

- 13f68ff: Inject `getRawBody` and `reqHeaders` into oRPC handler context so plugins can verify webhook signatures

  - Host session middleware now clones the request body before oRPC consumes it, exposing `getRawBody()` in context for raw body access
  - Dev server middleware also injects `reqHeaders` and `getRawBody` (previously passed `context: {}`)
  - API, projects, registry, and template plugins declare `getRawBody` in their context schemas
  - API plugin `reqHeaders` type changed from `z.custom<Record<string, string>>()` to `z.record(z.string(), z.string())` for proper runtime validation

## 1.0.2

### Patch Changes

- a0c5784: Upgrade `@hono/node-server` to `^2.0.1` across host and everything-dev packages.

  Bump dev dependencies group:

  - `@biomejs/biome` `2.4.10` → `2.4.14`
  - `@effect/language-service` `^0.84.3` → `^0.85.1`
  - `@electric-sql/pglite` `^0.2.0` → `^0.4.5`
  - `@vitest/ui` `4.1.2` → `4.1.5`

## 1.0.1

### Patch Changes

- 0a67206: Refactor dev orchestrator to service-descriptor architecture; add NEAR auth contract routes (nonce, verify, profile, relay, view); consolidate session queries in UI; add source-map devtool for plugin builds

## 1.0.0

### Major Changes

- f080b87: Release v1.0.0 of the everything-dev toolchain.

  - Promote api, ui, everything-dev, and every-plugin to stable 1.0.0
  - Promote the plugin template package to stable 1.0.0
