# api

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
