# @every-plugin/template

## 1.2.1

### Patch Changes

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

## 1.2.0

### Minor Changes

- 4772e1f: Simplify API to a thin orchestration layer: replaces the upvotes table with a `things` registry (`thingId`, `pluginId`, `createdAt`, `updatedAt`), adds Effect service layers (Registry, Votes), and introduces plugin dispatch via `getThingProvider()` so the API delegates to plugins by `pluginId`. Adds `createThing`, `getThing`, `deleteThing` (admin-only), `subscribeThings` endpoints with SSE filtering by `pluginId`/`type`/`action`. Adds `deleteThing` to `_template` plugin contract/service/handler. Extracts `ApiContextSchema`, `pluginContext`, `runEffect` into `lib/context.ts`. Renames service files `thing-registry`→`registry`, `thing-votes`→`votes` with matching symbol renames. Removes obsolete `lib/plugins.ts`. Adds frontend thing registry routes under `/things/` (index, create, detail with vote controls, admin delete, live SSE stream). Improves DB Layer with idempotent migrator. Updates api-and-auth and plugin-development skill docs.

## 1.1.0

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
