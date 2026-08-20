---
name: api-and-auth
description: API architecture, oRPC contracts, auth middleware, plugin-client composition, session handling, and client-side auth. Use when adding API routes, creating middleware, calling other plugins in-process, or integrating auth in routes and UI.
metadata:
  sources: "api/src/index.ts,api/src/contract.ts,api/src/lib/auth.ts,host/src/services/auth.ts,host/src/services/plugins.ts,host/src/program.ts,ui/src/lib/auth.ts,ui/src/lib/api.ts"
---

# API Architecture & Auth

## Plugin Anatomy

The API is an every-plugin registered via `createPlugin.withPlugins<PluginsClient>()`:

```ts
export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({ /* typed config */ }),
  secrets: z.object({ /* typed env vars, defaults for dev */ }),
  context: z.object({ /* per-request context injected by host */ }),
  contract,
  initialize: (config, plugins, tools) =>
    Effect.gen(function* () {
      const registry = yield* tools.buildService(
        RegistryTag,
        RegistryLive.pipe(Layer.provide(DatabaseLive(config.secrets.API_DATABASE_URL))),
      );
      return { registry, publisher, auth: plugins.auth, plugins };
    }),
  shutdown: (deps) => Effect.promise(async () => { /* cleanup */ }),
  createRouter: (deps, builder) => ({
    ping: builder.ping.handler(async () => ({ status: "ok", timestamp })),
  }),
});
```

Fields: `variables` (public config), `secrets` (private env), `context` (per-request host context), `contract` (oRPC router), `initialize` (startup, returns services; third arg `tools` for scoped resources), `createRouter` (maps procedures to handlers), `shutdown` (cleanup). `plugins` in `initialize` gives typed factories for all other plugins. Use `tools.buildService(tag, layer)` for DB-backed services, caches, and other scoped resources.

## oRPC Contract Design

Defined in `api/src/contract.ts`:

```ts
import { BAD_REQUEST, NOT_FOUND, UNAUTHORIZED } from "every-plugin/errors";
import { eventIterator, oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

export const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(
    z.object({ status: z.literal("ok"), timestamp: z.iso.datetime() }),
  ),
  upvoteThing: oc
    .route({ method: "POST", path: "/upvotes" })
    .input(z.object({ thingId: z.string() }))
    .output(z.object({ thingId: z.string(), userId: z.string(), totalCount: z.number().int().nonnegative() }))
    .errors({ UNAUTHORIZED, BAD_REQUEST }),
  getUserVote: oc
    .route({ method: "GET", path: "/upvotes/{thingId}/me" })
    .input(z.object({ thingId: z.string() }))
    .output(z.object({ thingId: z.string(), hasUpvote: z.boolean() }))
    .errors({ UNAUTHORIZED }),
  getUpvoteFeed: oc
    .route({ method: "GET", path: "/upvotes/feed" })
    .input(z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() }))
    .output(z.object({ data: z.array(/*...*/), meta: z.object({ total, hasMore, nextCursor }) })),
  subscribeUpvotes: oc
    .route({ method: "GET", path: "/upvotes/stream" })
    .output(eventIterator(VoteEventSchema)),
});
```

Conventions: `.errors()` declares typed errors, `{paramName}` path params match Zod input keys, `.output(eventIterator(Schema))` enables SSE streaming, export `type ContractType = typeof contract` for type generation.

## Route Implementation

```ts
createRouter: (services, builder) => {
  const { requireAuth } = createAuthMiddleware(builder);

  return {
    ping: builder.ping.handler(async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
    })),
    upvoteThing: builder.upvoteThing.use(requireAuth).handler(async ({ input, context }) => {
      return await services.upvoteService.upvoteThing(input.thingId, context.userId);
    }),
    subscribeUpvotes: builder.subscribeUpvotes.handler(async function* ({ signal, lastEventId }) {
      const iterator = services.publisher.subscribe("vote", { signal, lastEventId });
      for await (const event of iterator) yield event;
    }),
  };
};
```

Handler receives `{ input, context, signal?, lastEventId? }`.

## Middleware

Create auth middleware with `createAuthMiddleware(builder)` in `api/src/lib/auth.ts`. Each middleware narrows the context type through `.use()` — no non-null assertions needed.

```ts
const { requireAuth } = createAuthMiddleware(builder);

builder.myRoute.use(requireAuth).handler(async ({ input, context }) => {
  context.userId; // string — narrowed by middleware
});
```

Available: `requireAuth`, `requireAuthOrApiKey`, `requireRole("admin")`, `requireOrganization`, `requireOrgRole("owner")`, `requireApiKey`. Apply via `.use()`:

```ts
builder.authHealth.use(requireAuth).handler(...)
builder.adminAction.use(requireRole("admin")).handler(...)
```

See `references/middleware.md` for the full middleware table, org metadata validation, and typed context helpers.

## Error Handling

Use `ORPCError` from `every-plugin/errors`:

```ts
import { ORPCError } from "every-plugin/orpc";
import { BAD_REQUEST, UNAUTHORIZED } from "every-plugin/errors";

throw new ORPCError("UNAUTHORIZED", {
  message: "Authentication required",
  data: { hint: "Sign in or provide an API key" },
});
```

Declare throwable errors in the contract via `.errors({ UNAUTHORIZED, BAD_REQUEST })`. Client-side errors are intercepted by `onError` in `createRpcLink` (`ui/src/lib/api.ts`).

## Auth Plugin Architecture

The auth plugin is an **external plugin** loaded in **Phase 0** of the host's initialization:

1. **Phase 0** (`host/src/services/plugins.ts`): Load auth plugin, create `authClient` factory.
2. **Phase 1**: Load all non-API plugins.
3. **Phase 2**: Load API plugin with `pluginsClient` (includes auth + all other plugin factories).

The host mounts the auth handler at `/api/auth/*`:

```ts
// host/src/services/auth.ts
export function registerAuthHandler(app, plugins) {
  const services = getAuthServices(plugins);
  if (!services) return;
  app.on(["POST", "GET"], "/api/auth/*", (c) => services.handler(c.req.raw));
}
```

## Session Middleware

Runs on every non-auth request. Resolves the session from cookies and sets Hono request context:

```ts
// host/src/services/auth.ts
export function createSessionMiddleware(plugins) {
  return async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    c.set("reqHeaders", c.req.raw.headers);

    const authClient = authClientFactory({ reqHeaders });
    const [session, context] = await Promise.all([
      authClient.getSession(),
      authClient.getContext(),
    ]);

    c.set("user", session?.user ?? context.user ?? null);
    c.set("session", session?.session ?? null);
    c.set("walletAddress", context.near.primaryAccountId ?? null);
    c.set("apiKey", context.apiKey ?? null);
    c.set("organizationId", context.organization?.activeOrganizationId ?? null);

    await next();
  };
}
```

If resolution fails, all values are `null` — `requireAuth` routes reject with `UNAUTHORIZED`.

The context is transformed for the API plugin via `buildPluginContext()`, with the full `organization` envelope from Better Auth:

```ts
export function buildPluginContext(c) {
  return {
    userId: user?.id, user: user ?? undefined,
    organization: context.organization ?? undefined,
    apiKey: apiKey ?? undefined,
    reqHeaders: c.get("reqHeaders"),
    getRawBody: c.get("getRawBody"),
  };
}
```

## Auth in API Routes

The API plugin receives `auth` in `initialize`:

```ts
initialize: (config, plugins, _tools) =>
  Effect.gen(function* () {
    const { auth, ...restPlugins } = plugins;
    return { auth, plugins: restPlugins, ... };
  })
```

Use `getAuthClient()` for in-process calls:

```ts
import { getAuthClient, createAuthMiddleware } from "./lib/auth";

const authClient = getAuthClient(services, { reqHeaders: context.reqHeaders });
const session = await authClient.getSession();
```

`AuthCapableServices` requires an `auth` factory. If unavailable, `getAuthClient()` throws.

## Auth on the Client

Create the client in `ui/src/lib/auth.ts`:

```ts
export function createAuthClient(runtimeConfig) {
  return betterAuth.createClient({
    baseURL: runtimeConfig.authBaseUrl,
    plugins: [siwn({ recipients, networkId }), passkey(), organization(), admin(), apiKey(), anonymous(), phone()],
  });
}
```

In route code:

```ts
import { useAuthClient, sessionQueryOptions } from "@/app";

const authClient = useAuthClient();
```

The `sessionQueryOptions()` helper provides standard TanStack Query config:

```ts
const session = await queryClient.ensureQueryData(
  sessionQueryOptions(authClient, context.session),
);
```

### Auth Route Guard

The `_authenticated.tsx` layout redirects unauthenticated users:

```ts
export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );
    if (!session?.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { auth: { isAuthenticated: true, user: session.user, session: session.session } };
  },
  component: AuthenticatedLayout,
});
```

## Plugin Client Composition

The host uses **two-phase loading** so API plugins can call other plugins in-process:

1. **Phase 0**: Auth plugin → `authClient` factory
2. **Phase 1**: All non-API plugins → `pluginsClient` map of `createClient` factories
3. **Phase 2**: API plugin with all plugin factories merged

```ts
// host/src/services/plugins.ts
const pluginsClient = { ...pluginClients };
if (authClient) pluginsClient.auth = authClient;
const baseApi = await loadPluginEntry(runtime, apiEntry, integrityRegistry, pluginsClient);
```

### Calling Plugins from API Routes

The API plugin receives `plugins` in `initialize`:

```ts
initialize: (config, plugins, _tools) =>
  Effect.gen(function* () {
    const authClient = plugins.auth({ reqHeaders: someHeaders });
    const session = await authClient.getSession();
    return { auth: plugins.auth, plugins, ... };
  })
```

### API-Owned Registry Pattern

When the API owns the durable registry and a plugin owns the semantic payload:

```ts
const provider = thingProviders[input.pluginId];
if (!provider) {
  throw new ORPCError("BAD_REQUEST", { message: `Unsupported pluginId: ${input.pluginId}` });
}
```

Rules: API owns `thingId`, `pluginId`, timestamps. Plugin owns `type` and `payload`. Keep one SSE stream per concept and filter server-side.

### Effect and DB Lifecycle

Prefer `Layer` for long-lived resources (DB, service singletons) and `Effect` for the work itself. Use `runEffect()` to bridge Effect and async handlers with clean ORPC error boundaries — unwraps `ORPCError` from Effect and converts unknown errors to `INTERNAL_SERVER_ERROR`:

```ts
import { runEffect } from "@/lib/context";

const result = await runEffect(services.myService.doSomething(input));
```

Best practices: Keep service interfaces Effect-native, bridge to async only at the handler boundary via `runEffect()`. Use `Context.Tag` for DI between services.

**Scoped resources** — For DB pools, caches, publishers, or any resource that must live for the plugin's lifetime, build them inside `initialize` using `tools.buildService(tag, layer)`. This binds the resource to the plugin lifecycle scope — it persists until plugin shutdown and is automatically released.

```ts
initialize: (config, plugins, tools) =>
  Effect.gen(function* () {
    const repo = yield* tools.buildService(
      MyRepoTag,
      MyRepoLive.pipe(Layer.provide(DatabaseLive(config.secrets.MY_DATABASE_URL))),
    );
    return { repo, plugins };
  }),
```

Do **not** use `Effect.provide(Tag, Layer.scoped(...))` inside `initialize` for long-lived resources — it creates a transient scope that closes immediately. `tools.buildService(...)` uses the plugin's lifecycle scope instead.

### SSR Proxy Client

`createPluginsClient()` creates a Proxy that merges the API client with all plugin clients:

```ts
export function createPluginsClient(result, context) {
  const apiClient = result.api?.createClient(context);
  const pluginClients = {};
  for (const [key, plugin] of Object.entries(result.plugins)) {
    if (key === "api") continue;
    pluginClients[key] = plugin.createClient(context);
  }
  if (result.authClient) pluginClients.auth = result.authClient(context);

  return new Proxy(apiClient, {
    get(target, key) {
      if (typeof key === "string" && key in pluginClients) return pluginClients[key];
      return Reflect.get(target, key);
    },
  });
}
```

### Tenant-Scoped Data

A **tenant** is a deployment record (subdomain + NEAR account + UI/backend/SSR override
permissions) — distinct from an organization (a group of users) and from a user's own data.
If your plugin stores data that belongs to a specific tenant deployment (not just a user or
org), resolve the tenant and scope every query to it.

The `api` plugin owns the `tenants` table and exposes public lookup routes (no auth required —
tenant lookups are read-only and safe to expose):

```ts
// From any plugin, via pluginsClient.api (injected through withPlugins<PluginsClient>())
const tenant = context.organization?.activeOrganizationId
  ? await plugins.api().resolveTenantByOrgId({ orgId: context.organization.activeOrganizationId })
  : await plugins.api().resolveTenant({ accountId: context.near?.primaryAccountId ?? "" });
```

Build a local `requireTenant` middleware in your own plugin (mirrors `requireOrganization`):

```ts
const requireTenant = builder.middleware(async ({ context, next }) => {
  const activeOrgId = context.organization?.activeOrganizationId;
  const tenant = activeOrgId
    ? await plugins.api().resolveTenantByOrgId({ orgId: activeOrgId }).catch(() => null)
    : null;
  if (!tenant) {
    throw new ORPCError("FORBIDDEN", { message: "No tenant found for this organization" });
  }
  return next({ context: { ...context, tenant } });
});

builder.listReports.use(requireTenant).handler(async ({ context }) => {
  return await services.reports.listByTenant(context.tenant.id); // always filtered
});
```

**Row-level convention (interim isolation)**: add a `tenantId` column to any table holding
tenant-specific application data, resolved server-side and never trusted from client input —
same discipline the `tenants` table itself uses for `orgId` scoping. See
`plugins/_template/src/db/schema.ts` for a commented example table.

**Forward path**: the target architecture (see `plans/beta-v2-tenants.md`) is per-tenant-per-plugin
Postgres schema isolation (`tenant_<id>_plugin_<name>`, `search_path` injected per request). That
requires request-scoped DB access instead of the current initialize-time singleton pattern — a
larger change, only worth it once there's a real multi-tenant plugin ecosystem to isolate. The
`tenantId` column convention above is forward-compatible: when schema isolation lands, the column
becomes redundant and can be dropped without reworking query logic.

## Generated Types

See `references/generated-types.md` for the full table — files, contents, and regeneration triggers.

## SSE Notes

Prefer a single publisher channel per concept and filter on the consumer side:

```ts
const iterator = services.publisher.subscribe("thing", { signal, lastEventId });
for await (const event of iterator) {
  if (input.pluginId && event.pluginId !== input.pluginId) continue;
  yield event;
}
```

## How Routes Are Mounted

The host (`host/src/program.ts`) creates RPC and OpenAPI handlers from each plugin's router, mounted at `/api/rpc/<plugin-namespace>`. The session middleware runs on `/api/*` before the RPC handlers, ensuring context is set.
