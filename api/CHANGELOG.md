# api

## 2.7.7

### Patch Changes

- 3be7608: Add PluginIdTag to Effect context for reliable plugin slug derivation in production

  - `every-plugin`: Exports `PluginIdTag` (`Context.Tag<string>`) and provides it via `Effect.provideService` during plugin initialization
  - `api`: Replaces `getMigrationSlug(import.meta.dirname)` with `yield* PluginIdTag` so the slug resolves correctly in Module Federation remotes
  - `everything-dev`: Adds `pg` to dependencies and `neverBundle` to fix module resolution in child projects running `bos db doctor`/`repair`

## 2.7.6

### Patch Changes

- 9d17953: Fixed `tools` parameter type in plugin `initialize` — it was incorrectly typed as optional (`tools?:`) but is always provided by the plugin runtime. Child repos no longer need `tools!.buildService()` workarounds.

## 2.7.5

### Patch Changes

- acf134e: Removed the pglite URL validation guard on `API_DATABASE_URL` in production. Added `tsconfig.json` and `tsconfig.contract.json` to the plugin sync template, so plugin tsconfigs are now framework-owned and synced during `bos sync`.

## 2.7.4

### Patch Changes

- 58272ad: Security and correctness fixes from codebase audit:

  - **Require `API_DATABASE_URL` in production** — Removed the `:memory:` PGlite default from the API plugin schema. Uses a Zod `refine()` that rejects `pglite:` URLs when `NODE_ENV=production`, preventing silent data loss on restart. Updated `drizzle.config.ts` fallback to throw in production.
  - **Add warnings to empty catch blocks** — Added `console.warn` to 5 empty `catch {}` blocks across `config.ts` (\_resolved.json parse, package.json name resolution), `orchestrator.ts` (manifest fetch failure), and `cli/upgrade.ts` (plugin config parse and file deletion), turning silent fallbacks into actionable diagnostics.
  - **Add CSRF protection middleware** — Added `createCsrfMiddleware` to the host server that validates `Origin`/`Referer` headers against the allowed origins list for state-changing methods (POST/PUT/DELETE/PATCH), preventing cross-origin request forgery on cookie-authenticated endpoints.

## 2.7.3

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

## 2.7.2

### Patch Changes

- 98ca5c3: feat(api): typed middleware context narrowing with Zod org metadata parsing

  - Added `parseOrgMetadata` helper that validates org metadata via an
    optional Zod schema at runtime, falling back to `Record<string, unknown>`
    when no schema is provided. Throws `INTERNAL_SERVER_ERROR` on parse
    failure (data integrity).
  - Added `UserMiddleware`, `OrgMiddleware`, `MemberMiddleware`,
    `ApiKeyMiddleware` type aliases so all middleware casts are
    self-documenting and dry.
  - Derived `OrgAuthenticatedContext<TMeta>` and
    `OrgMemberAuthenticatedContext<TMeta>` from generated
    `AuthOrganizationContext`/`AuthOrganizationSummary` — only
    `activeOrganizationId`, `metadata`, and `member` are manually
    narrowed; everything else (including future auth plugin fields)
    flows from the generated types automatically.
  - All middlewares now properly type-narrow context through `.use()`.
    `userId`/`user` are `string`/`RequestAuthUser` (non-null) after
    `requireAuth`; `activeOrganizationId` is `string` after
    `requireOrganization`; `apiKey` is `ApiKeyContext` after
    `requireApiKey`.
  - Removed `requireUser` (was identical to `requireAuth`).
  - Fixed `requireAuthOrApiKey` to pass the full context through (was
    passing `{}`, misleadingly suggesting context was cleared).
  - Fixed latent bug: `.use(requireAuthOrApiKey())` → `.use(requireAuthOrApiKey)`.
  - Removed stale `context.userId!` non-null assertions throughout
    route handlers.

## 2.7.1

### Patch Changes

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

## 2.7.0

### Minor Changes

- 4772e1f: Simplify API to a thin orchestration layer: replaces the upvotes table with a `things` registry (`thingId`, `pluginId`, `createdAt`, `updatedAt`), adds Effect service layers (Registry, Votes), and introduces plugin dispatch via `getThingProvider()` so the API delegates to plugins by `pluginId`. Adds `createThing`, `getThing`, `deleteThing` (admin-only), `subscribeThings` endpoints with SSE filtering by `pluginId`/`type`/`action`. Adds `deleteThing` to `_template` plugin contract/service/handler. Extracts `ApiContextSchema`, `pluginContext`, `runEffect` into `lib/context.ts`. Renames service files `thing-registry`→`registry`, `thing-votes`→`votes` with matching symbol renames. Removes obsolete `lib/plugins.ts`. Adds frontend thing registry routes under `/things/` (index, create, detail with vote controls, admin delete, live SSE stream). Improves DB Layer with idempotent migrator. Updates api-and-auth and plugin-development skill docs.

### Patch Changes

- 3733ef7: Rename `api/src/lib/plugins.ts` to `api/src/lib/context.ts`. Extract `ContextSchema` as a shared Zod schema with derived `Context` type, replacing the inline schema in `createPlugin`. Add old path to `OBSOLETE_FILES` in upgrade.

## 2.6.0

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

## 2.5.0

### Minor Changes

- b662086: Replace manual EventSource SSE with oRPC MemoryPublisher + eventIterator. Eliminates MaxListenersExceededWarning from Node EventTarget, stabilizes query keys to prevent refetch cascades, and adds typed streaming via VoteEventSchema contract.
