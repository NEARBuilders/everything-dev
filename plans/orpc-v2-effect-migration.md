# oRPC V1 → V2 + Effect Integration Migration

## Problem

The codebase runs oRPC v1.14.x. Every plugin, the host, the UI client, and the
`every-plugin` package all depend on V1 APIs and patterns. oRPC V2 introduces
breaking protocol and API changes. Additionally, the new Effect integration
(`@orpc/experimental-effect`) enables first-class Effect handlers, eliminating
the need for bespoke `tools.buildService()`, `Effect.runPromise()` bridging, and
manual FiberFailure unwrapping.

Upgrading unlocks:

- **Effect-native handlers** — `handlerGen` / `.effect` extension, handlers are
  `Effect.gen` generators
- **No more `buildService`** — `WithEffectContext` provides Effect services via
  oRPC context, `initialize` returns pure `Layer` values
- **No more `runEffect` bridge** — `Effect.fail(new ORPCError(...))` is
  natively understood
- **Error status mapping centralized** — `errorStatusMap` on the handler, not
  scattered across error schema definitions
- **Plugin imports simplified** — plugins import from `@orpc/contract`, `effect`,
  `zod` directly; `every-plugin` re-export barrels are removed
- **Zod v4 native** — already on Zod 4.4.3, TanStack Router uses direct schemas
- **Better batching** — supports all response types
- **No middleware dedup magic** — explicit control

## Goals

1. Upgrade oRPC to V2 across all packages
2. Integrate `@orpc/experimental-effect` (handlerGen, WithEffectContext)
3. Remove `tools.buildService()` from `every-plugin` — initialize returns Layers
4. Remove `every-plugin/orpc`, `every-plugin/effect`, `every-plugin/zod` re-exports
5. Plugins import from standard packages directly
6. Contracts use `.route` extension (zero contract syntax change)
7. Centralize error status codes in `errorStatusMap`
8. UI client uses V2 `RPCLink` (origin + url split)
9. Deploy host + UI atomically (protocol incompatibility)

## Non-Goals

- Replacing Zod with Effect Schema for contracts (can be done later)
- Moving to `@orpc/publisher` stable (publisher usage is minimal)
- Changing the Module Federation architecture

---

## Phase 1: `every-plugin` Internal Refactor

### 1.1 Remove dead re-exports

**Files to change:**
- `packages/every-plugin/src/orpc-openapi.ts` — delete file (0 consumers)
- `packages/every-plugin/src/zod-core.ts` — delete file (0 consumers)
- `packages/every-plugin/src/errors.ts` — remove `status` from all error schemas
- `packages/every-plugin/package.json` — remove `./orpc/openapi` and `./zod-core` exports

**Before:**
```typescript
// errors.ts
export const UNAUTHORIZED = { status: 401, data: z.object({...}) };
export const BAD_REQUEST = { status: 400, data: z.object({...}) };
```

**After:**
```typescript
// errors.ts — status field removed, moved to errorStatusMap in Phase 4
export const UNAUTHORIZED = { data: z.object({...}) };
export const BAD_REQUEST = { data: z.object({...}) };
```

### 1.2 Pre-load `.route` extension

**File:** `packages/every-plugin/src/index.ts`

Add a side-effect import so all plugins get `.route()` on the builder without
importing `@orpc/openapi` themselves:

```typescript
// patches os globally (safe — os is a Module Federation singleton)
import "@orpc/openapi/extensions/route";
```

This must run before any contract is evaluated. Since `every-plugin` is loaded
before plugins (it's the plugin factory), this is the right place.

### 1.3 Pre-load `.effect` extension

**File:** `packages/every-plugin/src/index.ts`

```typescript
import "@orpc/experimental-effect/extensions/effect";
```

Gives every plugin `builder.X.effect(function* () { ... })` without importing it.

### 1.4 Restructure `createPlugin` — Layer-based initialize, Effect handlers

**File:** `packages/every-plugin/src/plugin.ts`

Remove `tools` parameter. `initialize` returns `Effect<Layer<Requirements, Error>, Error, Scope>`.
The runtime provides the built Layer via `WithEffectContext` in oRPC context.

```typescript
// OLD
type PluginServicesTools = {
  buildService: <T>(tag: T, layer: Layer.Layer<any, any, any>) =>
    Effect.Effect<ServiceOf<T>>;
};

// NEW — no tools, initialize returns a Layer
type PluginDefinition = {
  initialize?: (
    config: PluginInitializeInput<V, S>,
    plugins: P,
    // tools: PluginServicesTools  ← REMOVED
  ) => Effect.Effect<Layer.Layer<any, Error>, Error, Scope.Scope>;
  createRouter: (
    builder: Implementer<...>,  // deps removed — services come from Effect context
  ) => Router<TContract, any>;
};
```

The `createRouter` no longer receives `deps` — services are accessed via
`yield* Tag` in `.effect()` handlers.

### 1.5 Runtime: provide Effect context

**File:** `packages/every-plugin/src/runtime/services/plugin-loader.service.ts`

In `initializePlugin`, change from `tools.buildService` to:
1. Call `initialize` → get `Layer`
2. Merge all plugin Layers at the runtime level
3. Pass merged `Effect.Context` as `effect/context` in oRPC handler context

The per-plugin `Scope` is still created but now scoped to the Layer's lifecycle,
not to individual service extraction.

### 1.6 Add `errorStatusMap` support

**File:** `packages/every-plugin/src/plugin.ts`

Accept an optional `errorStatusMap` in the plugin config:

```typescript
type PluginConfig = {
  // ...
  errorStatusMap?: Record<string, number>;
};
```

This gets passed to `RPCHandler` in the host/plugin loader.

### 1.7 Plugin router composition

**Problem:** Plugins that want to expose another plugin's routes at their own
namespace must currently (1) redefine schemas in their contract, (2) create a
client from `_plugins`, and (3) write individual one-liner passthrough handlers.
This is boilerplate and requires schema duplication.

Example: API plugin currently needs 4 passthrough handlers + 3 redefined schemas
just to expose the template plugin's `/things` routes at `/api/things`.

**Goal:** `createRouter` should be able to merge another plugin's raw router
directly, without redefining contracts or writing per-route handlers:

```typescript
// Desired
createRouter: (builder) => ({
  ping: builder.ping.handler(...),
  ...router.merge(templateRouter, { prefix: "/things" }),
})
```

**What's needed:**

- Host passes raw routers (not just client factories) through `_plugins` or a
  new plugins mechanism
- `every-plugin` provides a `router.merge()` helper or exposes routers in
  `createRouter` context
- Types: `PluginsClient` gains `Router<...>` entries alongside `ClientFactory`
- Contracts: merged routes appear in API's OpenAPI spec automatically
- Error status codes flow through without re-declaration

**Current blocker:** `_plugins` only provides `ClientFactory` (function →
`ContractRouterClient`), not the raw `Router` object. The raw routers exist on
`HostPluginEntry.router` but are never passed to plugin `initialize`. The host
would need to pass `{ template: { client: ClientFactory, router: Router } }`
instead of `{ template: ClientFactory }`.

**Effort:** M. Depends on 1.4 (Layer-based initialize). Best done after the
Effect migration, when `createPlugin` API is already being restructured.

---

## Phase 2: Plugin Contract Migration

V2 removes `.route()` from the builder — it moves to `openapi()` metadata in
`@orpc/openapi`. Because Phase 1.2 pre-loads the `.route` extension, contracts
require **zero syntax changes**.

### 2.1 Verify contracts compile

Every `oc.route({ method, path })` still works via the extension.

**Files to verify:** all `plugins/*/src/contract.ts`, `api/src/contract.ts`

### 2.2 Error schema cleanup

Remove `status` from custom error schemas in contract `.errors()` definitions.
Example in `_template`:

```diff
 const Errors = {
-  NOT_FOUND: { status: 404, data: z.object({ id: z.string() }) },
+  NOT_FOUND: { data: z.object({ id: z.string() }) },
-  BAD_REQUEST: { status: 400, data: z.object({ fields: z.array(z.string()) }) },
+  BAD_REQUEST: { data: z.object({ fields: z.array(z.string()) }) },
 };
```

### 2.3 Streaming contracts

`eventIterator` is renamed to `asyncIteratorObject` (deprecated alias works):

```typescript
// Can do incrementally
import { asyncIteratorObject } from "@orpc/contract";
// alias still works:
import { eventIterator } from "@orpc/contract"; // deprecated, still compiles
```

---

## Phase 3: Plugin Implementation Migration

### 3.1 Remove `tools.buildService`, return Layers

**Pattern change for every plugin `index.ts`:**

```typescript
// OLD
initialize: (config, _plugins, tools) =>
  Effect.gen(function* () {
    const db = DatabaseLive(config.secrets.DB_URL);
    const svc = yield* tools.buildService(ThingsService, ThingsService.Live.pipe(Layer.provide(db)));
    return { svc };
  }),
createRouter: (deps, builder) => ({
  getById: builder.getById.handler(async ({ input }) => {
    return await Effect.runPromise(deps.svc.getById(input.id));
  }),
})

// NEW
initialize: (config) =>
  Effect.succeed(
    ThingsService.Live.pipe(Layer.provide(DatabaseLive(config.secrets.DB_URL)))
  ),
createRouter: (builder) => ({
  getById: builder.getById.effect(function* ({ input }) {
    const svc = yield* ThingsService;
    return yield* svc.getById(input.id);
  }),
})
```

### 3.2 Remove `runEffect` and `context.ts`

**Files to remove from each plugin:** `src/lib/context.ts`
The Effect→ORPCError bridge is no longer needed — `Effect.fail(new ORPCError(...))`
is natively handled by the Effect integration.

### 3.3 Update auth middleware

**Files:** `api/src/lib/auth.ts`, `plugins/*/src/lib/auth.ts`

```typescript
// OLD: builder.middleware(async ({ context, next }) => {...})
// NEW: use oRPC V2 .use() pattern with Effect

const requireAuth = builder.use(async ({ context, next }) => {
  if (!context.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "...", data: {...} });
  }
  return next({ context: { userId: context.user.id } });
});
```

Note: `.concat` → `.use` rename (deprecated alias still works).

### 3.4 Update streaming handlers

```typescript
// OLD
builder.search.handler(async function* ({ input }) {
  for await (const result of generator) { yield result; }
})

// NEW — same syntax, just update type names
// asyncIteratorObject replaces eventIterator in output schema
builder.search.handler(async function* ({ input }) {
  for (const result of generator) { yield result; }
})
```

### 3.5 Update imports in every plugin

```diff
- import { createPlugin } from "every-plugin";
- import { Effect, Layer } from "every-plugin/effect";
- import { MemoryPublisher, ORPCError, getEventMeta, oc } from "every-plugin/orpc";
- import { z } from "every-plugin/zod";
+ import { createPlugin } from "every-plugin";
+ import { Context, Effect, Layer } from "effect";
+ import { ORPCError } from "@orpc/server";
+ import { z } from "zod";
```

---

## Phase 4: Host Migration

### 4.1 Update package dependencies

```diff
- "@orpc/server": "catalog:"
- "@orpc/openapi": "catalog:"
- "@orpc/zod": "catalog:"
- "@orpc/contract": "catalog:"
+ "@orpc/server": "catalog:v2"
+ "@orpc/openapi": "catalog:v2"
+ "@orpc/zod": "catalog:v2"      // requires zod v4 (already met)
+ "@orpc/contract": "catalog:v2"
+ "@orpc/experimental-effect": "catalog:v2"
```

Update root catalog versions.

### 4.2 Update RPCHandler options

**File:** `host/src/program.ts`

```diff
  const rpcHandler = new RPCHandler(apiRouter, {
    plugins: [new BatchHandlerPlugin()],
-   interceptors: [
+   routingInterceptors: [
      onError((error) => { /* ... */ }),
    ],
+   errorStatusMap: {
+     UNAUTHORIZED: 401,
+     NOT_FOUND: 404,
+     BAD_REQUEST: 400,
+     FORBIDDEN: 403,
+     RATE_LIMITED: 429,
+     TIMEOUT: 408,
+     SERVICE_UNAVAILABLE: 503,
+     INTERNAL_SERVER_ERROR: 500,
+     // ... all error codes used by plugins
+   },
  });
```

### 4.3 Update OpenAPIHandler

```diff
  const apiHandler = new OpenAPIHandler(apiRouter, {
    plugins: [
-     new OpenAPIReferencePlugin({
-       schemaConverters: [new ZodToJsonSchemaConverter()],
-       specGenerateOptions: { info: {...}, servers: [...] },
+     new OpenAPIReferenceHandlerPlugin({
+       provider: "scalar",
+       spec: () => new OpenAPIGenerator({
+         converters: [new ZodToJsonSchemaConverter()],
+       }).generate(apiRouter, {
+         base: { info: {...}, servers: [...] },
+       }),
      }),
    ],
-   interceptors: [onError((error) => { ... })],
+   routingInterceptors: [onError((error) => { ... })],
  });
```

### 4.4 Update ZodToJsonSchemaConverter import

```diff
- import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
+ import { ZodToJsonSchemaConverter } from "@orpc/zod";
```

V2 removes the `zod/zod4` subpath.

### 4.5 Plugin loading: provide Effect context

**File:** `host/src/services/plugins.ts`

After `initialize` for each plugin returns a `Layer`, merge them and provide
the merged `Effect.Context` via `effect/context` in oRPC handler context:

```typescript
import { Context as EffectContext } from "effect";

// After all plugins initialized:
const mergedContext = EffectContext.empty().pipe(
  EffectContext.add(PluginsService, pluginServices),
);

const context = {
  ...buildPluginContext(c),
  "effect/context": mergedContext,
};
```

### 4.6 Update MCP service

**File:** `host/src/services/mcp.ts`

`OpenAPIGenerator` options restructured:
- `schemaConverters` → `converters`
- `specGenerateOptions.info` → `base.info`

### 4.7 Update dev server middleware

**File:** `packages/every-plugin/src/build/rspack/dev-server-middleware.ts`

Same handler option changes as `program.ts`.

---

## Phase 5: UI Client Migration

### 5.1 Update RPCLink

**File:** `ui/src/lib/api.ts`

```diff
  const link = new RPCLink({
-   url: `${runtimeConfig.hostUrl}${runtimeConfig.rpcBase}`,
+   origin: runtimeConfig.hostUrl,
+   url: runtimeConfig.rpcBase,
-   interceptors: [
+   transportInterceptors: [
      onError((error) => { /* toast */ }),
    ],
-   fetch(url, options) {
+   fetch(url, init, { context }) {
-     return fetch(url, { ...options, credentials: "include" });
+     return globalThis.fetch(url, { ...init, credentials: "include" });
    },
  });
```

### 5.2 Update TanStack Query integration

```diff
  import { createTanstackQueryUtils } from "@orpc/tanstack-query";

- const orpc = createTanstackQueryUtils(client, { path: ["user"] });
+ const orpc = createTanstackQueryUtils(client, { prefix: "user" });
```

### 5.3 Update type annotations

```diff
- import type { ContractRouterClient } from "@orpc/contract";
- const client: ContractRouterClient<typeof contract> = createORPCClient(link);
+ import type { RouterContractClient } from "@orpc/contract";
+ const client: RouterContractClient<typeof contract> = createORPCClient(link);
```

Alias still works. Can do incrementally.

### 5.4 Update `safe()` callers

```diff
- import { isDefinedError, safe } from "@orpc/client";
- const [error, data, isDefined] = await safe(client.example({ id: 1 }));
+ import { isInferableError, safe } from "@orpc/client";
+ const [error, data, inferableError, isSuccess] = await safe(client.example({ id: 1 }));
```

⚠️ Tuple length changed. Audit all call sites.

---

## Phase 6: Generated Types

### 6.1 Update `bos types gen`

**File:** `packages/everything-dev/src/` (type generation logic)

- `ContractRouterClient` → `RouterContractClient`
- `AnyContractRouter` → `RouterContract`
- `InferContractRouterInputs` → `InferRouterContractInputs`
- `InferContractRouterOutputs` → `InferRouterContractOutputs`

### 6.2 Regenerate all type files

```bash
bos types gen
```

This regenerates:
- `api/src/lib/plugins-types.gen.ts`
- `api/src/lib/auth-types.gen.ts`
- `ui/src/lib/api-types.gen.ts`
- `ui/src/lib/auth-types.gen.ts`
- `plugins/*/src/lib/plugins-client.gen.ts`

---

## Phase 7: Module Federation Shared Deps

### 7.1 Update shared dependencies

**File:** `packages/every-plugin/src/runtime/services/module-federation.service.ts`

```diff
  "@orpc/contract": () => import("@orpc/contract"),
  "@orpc/client": () => import("@orpc/client"),
  "@orpc/server": () => import("@orpc/server"),
+ "@orpc/openapi": () => import("@orpc/openapi"),
+ "@orpc/experimental-effect": () => import("@orpc/experimental-effect"),
+ "@orpc/publisher": () => import("@orpc/publisher"),
```

### 7.2 Update rspack ModuleFederationPlugin config

**File:** `packages/every-plugin/src/build/rspack/plugin.ts`

Same shared dependency additions. Ensure plugins don't bundle their own copies.

---

## Phase 8: Testing

### 8.1 Plugin integration tests

**File:** `packages/every-plugin/tests/integration/`

- `createRouterClient` → verify still works with V2
- `RPCLink` → update URL pattern in test HTTP server setup
- `safe()` → update tuple destructuring

### 8.2 Plugin unit tests

**File:** `packages/every-plugin/tests/unit/scope-lifecycle.test.ts`

- Remove `tools.buildService` test cases
- Add `Layer`-based initialize tests
- Add `effect/context` provision tests

### 8.3 End-to-end validation

1. `bos dev` — all services start, RPC calls succeed
2. `bun run test` — all test suites pass
3. `bun typecheck` — no type errors
4. UI loads, auth works, plugin routes respond
5. OpenAPI docs load at `/api`
6. Streaming endpoints produce events

---

## Deployment Sequence

⚠️ **Protocol is incompatible.** V1 client cannot talk to V2 server.
Must deploy atomically.

1. Merge all changes to `main`
2. Build all workspaces: `bos build`
3. Deploy host + UI + all plugins together
4. Verify in production

No partial/rolling deployment possible.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `@orpc/experimental-effect` is experimental | Medium | Lock version. If removed/promoted before GA, update import paths. |
| Effect integration changes handler execution model | High | Comprehensive handler tests. Verify error propagation, scope lifecycle. |
| `safe()` tuple destructuring broken at call sites | Medium | Grep all `safe(` calls, audit each. |
| Middleware dedup removal causes double auth runs | Medium | Audit all `.use(authMiddleware)` call sites. Auth middleware already has context-flag pattern in some places. |
| Regular `oc.route()` not working without extension import | Low | Pre-loaded in `every-plugin` bootstrap (Phase 1.2). |
| Zod v4 incompatibility with any dependency | Low | Already on Zod 4.4.3. Better Auth 1.6.25 requires it. TanStack Router supports natively. |
| OpenAPI spec breaks | Low | Verify OpenAPIReferenceHandlerPlugin restructuring is correct. Test `/api` endpoint. |

---

## What Does NOT Change

- `oc.route({ method, path })` syntax — `.route` extension restores it
- Contract file structure — identical to today
- `createPlugin` import location — still `from "every-plugin"`
- Module Federation architecture — identical
- `bos dev`, `bos publish`, `bos types gen` — same CLI surface
- TanStack Router integration — already Zod v4 native
- Hono.js host — unchanged

---

## Post-Migration Cleanup (can be incremental)

- Rename `eventIterator` → `asyncIteratorObject` (deprecated alias works)
- Rename `isDefinedError` → `isInferableError` (deprecated alias works)
- Rename `ContractRouterClient` → `RouterContractClient` (deprecated alias works)
- Migrate from `@orpc/experimental-publisher` → `@orpc/publisher` when stable
- Consider Effect Schema for contracts (`.input(Schema.Struct(...))` instead of Zod)
- Remove deprecated alias usage codebase-wide

---

## Execution Order

| Phase | Title | Effort | Depends on |
|---|---|---|---|
| 1 | `every-plugin` internal refactor | L | — |
| 2 | Plugin contract migration | S | 1 |
| 3 | Plugin implementation migration | L | 1, 2 |
| 4 | Host migration | M | 1, 3 |
| 5 | UI client migration | M | 4 |
| 6 | Generated types | S | 2 |
| 7 | MF shared deps | S | 1 |
| 8 | Testing | M | 3, 4, 5 |
| — | Deploy | S | 8 |

Phase 1 is the critical path — everything depends on the new `createPlugin` API
and pre-loaded extensions. Phases 2-3 can parallelize across plugins once
Phase 1 is stable.
