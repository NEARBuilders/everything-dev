---
name: plugin-development
description: Build every-plugin modules with oRPC contracts, Effect services, and Module Federation. Use when creating or modifying plugins under plugins/ or the _template scaffold.
metadata:
  sources: "src/plugin.ts,src/errors.ts,src/types.ts,src/runtime/errors.ts,src/runtime/services/module-federation.service.ts,src/runtime/index.ts,plugins/_template/src/index.ts"
---

# every-plugin Development

## Plugin Structure

Every plugin has three core files:

```
plugins/your-plugin/
├── src/
│   ├── contract.ts    # oRPC route definitions + Zod schemas
│   ├── service.ts     # Business logic (plain class, Effect error handling)
│   ├── index.ts       # createPlugin() wiring
│   └── __tests__/     # Integration & unit tests
├── package.json
├── rspack.config.js   # Build config (every-plugin provides defaults)
├── plugin.dev.ts      # Dev server config (port, variables, secrets)
└── tsconfig.json
```

Import `zod`, `effect`, and `@orpc/*` directly — the `every-plugin/zod`, `every-plugin/orpc`, and `every-plugin/effect` facade barrels no longer exist. The build pins zod via the workspace catalog, so version skew between plugin and framework is not a concern.

## Step 1: Define the Contract

```typescript
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

const Errors = {
  UNAUTHORIZED: { status: 401, message: "Auth required" },
  NOT_FOUND: { status: 404, message: "Not found" },
};

export const contract = oc.router({
  getById: oc
    .route({ method: "GET", path: "/items/{id}" })
    .input(z.object({ id: z.string() }))
    .output(z.object({ item: ItemSchema }))
    .errors(Errors),

  search: oc
    .route({ method: "GET", path: "/search" })
    .input(z.object({ query: z.string(), limit: z.number().default(10) }))
    .output(eventIterator(SearchResultSchema)),

  ping: oc
    .route({ method: "GET", path: "/ping" })
    .output(z.object({ status: z.literal("ok"), timestamp: z.string().datetime() })),
});

export type ContractType = typeof contract;
```

Key points:
- Import `oc`/`eventIterator` from `@orpc/contract`, `z` from `zod`, `Effect`/`Layer`/`Context` from `effect`
- Use `eventIterator(schema)` for streaming responses
- Define error objects with `status` + `message` and pass via `.errors()`
- Use `PluginErrors` from `every-plugin/errors` for standard UNAUTHORIZED/FORBIDDEN/NOT_FOUND/BAD_REQUEST

## Step 2: Create the Service

Plain TypeScript class with Effect error handling:

```typescript
import { Effect } from "effect";

export class MyService {
  constructor(private baseUrl: string, private apiKey: string) {}

  getById(id: string) {
    return Effect.tryPromise({
      try: async () => {
        const res = await fetch(`${this.baseUrl}/items/${id}`);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        return res.json();
      },
      catch: (error: unknown) => new Error(`Failed to fetch item: ${error}`),
    });
  }

  ping() {
    return Effect.succeed({ status: "ok" as const, timestamp: new Date().toISOString() });
  }
}
```

## Step 3: Wire with createPlugin

```typescript
import { ORPCError } from "@orpc/server";
import { Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { MyService } from "./service";

export default createPlugin({
  variables: z.object({
    baseUrl: z.url().default("https://api.example.com"),
  }),
  secrets: z.object({
    apiKey: z.string().min(1),
  }),
  contract,

  initialize: (config, _plugins) =>
    Effect.gen(function* () {
      const service = new MyService(config.variables.baseUrl, config.secrets.apiKey);
      yield* service.ping();

      return Layer.succeed(MyServiceTag, service);
    }),

  createRouter: (builder) => ({
    getById: builder.getById.effect(function* ({ input, context, errors }) {
      if (!context.userId) {
        return yield* Effect.fail(errors.UNAUTHORIZED({ message: "Auth required" }));
      }
      const service = yield* MyServiceTag;
      return yield* service.getById(input.id);
    }),

    ping: builder.ping.effect(function* () {
      const service = yield* MyServiceTag;
      return yield* service.ping();
    }),
  }),
});
```

Key points:
- `initialize` returns an `Effect` producing a `Layer` — services built in it are provided to `.effect()` handlers via the plugin's lifecycle scope
- Teardown lives in Layer finalizers — there is no `shutdown` option
- Handlers access services with `yield* Tag` (Effect-native generators)
- For streaming handlers (async generators), use `Context.get(context["effect/context"], Tag)`

## Plugin Composition (withPlugins)

When an API plugin needs to call other plugins in-process:

```typescript
import type { PluginsClient } from "./lib/plugins-types.gen";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({ demoMessage: z.string().optional() }),
  contract,
  initialize: (config, plugins) =>
    Effect.sync(() => ({ plugins, demoMessage: config.variables.demoMessage ?? "not configured" })),
  createRouter: (builder) => ({
    pluginDemo: builder.pluginDemo.handler(async () => {
      const status = await deps.plugins.registry().getRegistryStatus();
      return { apiVariable: deps.demoMessage, registryStatus: status };
    }),
  }),
});
```

- `pluginsClient` is a map of `createClient` factories, typed by the generated `PluginsClient`
- Call `services.plugins.{key}()` to execute plugin routers in-process — no HTTP roundtrip
- The host loads non-API plugins first (Phase 1), then loads the API with `pluginsClient` injected (Phase 2)

## Long-Lived Scoped Resources

For database pools, caches, publisher channels, or any resource that should live for the plugin's lifetime, use `buildScoped(tag, layer)` inside `initialize` (or `buildScopedContext(layer)` for multi-service layers):

```typescript
import { Effect, Layer } from "effect";
import { buildScoped, createPlugin } from "every-plugin";

export default createPlugin({
  // ...
  initialize: (config, _plugins) =>
    Effect.gen(function* () {
      const repo = yield* buildScoped(
        MyRepoTag,
        MyRepoLive.pipe(Layer.provide(DatabaseLive(config.secrets.MY_DATABASE_URL))),
      );

      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 120 });

      return { repo, publisher };
    }),
  // ...
});
```

`buildScoped(tag, layer)` builds the layer with the plugin's lifecycle scope and resolves the service from the built context.
Resources persist until the plugin shuts down and are automatically cleaned up during `runtime.shutdown()`.

For layers that provide several services at once, use `buildScopedContext` and resolve each tag:

```typescript
const services = yield* buildScopedContext(
  Layer.mergeAll(TenantsLive, NodesLive).pipe(Layer.provide(database)),
);

const tenants = Context.get(services, TenantsTag);
```

**Bad — creates a transient scope that closes immediately:**
```typescript
const svc = yield* Effect.provide(MyTag, MyLive.pipe(Layer.provide(DatabaseLive(url))))
```

**Good — resources persist for the plugin's lifetime:**
```typescript
const svc = yield* buildScoped(MyTag, MyLive.pipe(Layer.provide(DatabaseLive(url))))
```

Key rules:
- Use `buildScoped(...)` for any `Layer.scoped(...)` resource that should survive initialization
- Plain class construction (new Service(...)) is still fine directly in `initialize`
- Handlers access services via the injected oRPC context (`yield* Tag` in `.effect()` handlers), not from initialize's return value
- Do not use `Effect.provide(Tag, Layer.scoped(...))` for persistent dependencies inside `initialize`

## Dev Server Config (plugin.dev.ts)

```typescript
import type { PluginConfigInput } from "every-plugin";
import Plugin from "./src/index";

export default {
  port: 3010,
  config: {
    variables: {
      baseUrl: "https://api.example.com",
    },
    secrets: {
      apiKey: "dev-only-key",
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
```

No `pluginId` field — the dev server derives the plugin id from the workspace
itself (the `plugins/<key>` layout key and the package.json name); it never
reads one from this file.

Port assignments: host=3000, api=3001, auth=3002, ui=3003, ui-ssr=3004, plugins=3010+.

## Build Config (rspack.config.js)

every-plugin provides rspack helpers as plugins:

```javascript
import {
  EmitPluginManifest,
  EveryPluginDevServer,
  FixMfDataUriPlugin,
} from "every-plugin/build/rspack";

export default {
  plugins: [
    new EmitPluginManifest(),
    new EveryPluginDevServer({ dts: false }),
    new FixMfDataUriPlugin(),
  ],
};
```

`EveryPluginDevServer` configures the Module Federation dev server defaults. Add the manifest/fix plugins the same way the package templates do.

## Common Mistakes

- Importing `z`/`oc`/`Effect` from `every-plugin/zod`, `every-plugin/orpc`, or `every-plugin/effect` — those facade barrels were deleted; import from `zod`, `@orpc/contract`, and `effect` directly
- Forgetting `.errors(Errors)` on routes that can throw ORPCError — untyped errors
- Using `Effect.runPromise` inside `Effect.gen` — use `yield*` instead for proper error channel
- Putting business logic in `createRouter` — keep it in the service class, router is just glue
- Using `Effect.provide(Tag, Layer.scoped(...))` inside `initialize` for long-lived resources — creates a transient scope that releases the resource immediately after initialization. Use `buildScoped(Tag, Layer.scoped(...))` instead

## The tasks you will actually be given

**"Add a route to a plugin"** — e.g. a `deleteItem` procedure. Add it to `plugins/<your-plugin>/src/contract.ts` (`.route({ method: "DELETE", path: "/items/{id}" }).input(...).errors(Errors)`), add a method on the service class, then wire it in `src/index.ts` as `deleteItem: builder.deleteItem.effect(function* ({ input, context, errors }) { ... })` — check `context.userId` first and fail with `errors.UNAUTHORIZED(...)` / `errors.NOT_FOUND(...)` inside the generator, mirroring `plugins/_template/src/index.ts` (`getById`, `deleteThing`). Verify with `cd plugins/<your-plugin> && pnpm test`, then `pnpm run typecheck` (regenerates `plugins-types.gen.ts` for cross-plugin consumers).

**"Ship a new plugin"** — copy `plugins/_template/` to `plugins/<key>/`, set `name` in its package.json (this is the registry id tests use), fill in `plugin.dev.ts` (port; plugins start at 3010), and register it in the authored config with `Plugin("<key>").path("plugins/<key>", { ... })` (see `bos.app.ts`). Run `bos types gen` or restart `pnpm run dev`, then deploy with `cd plugins/<key> && bos plugin publish <key>`.

**"A plugin fails to load in the host"** — capture the error words and match them in the table below; shared-identity failures are confirmed with `bos mf check` and fixed by rebuilding/redeploying the one plugin.

## What comes back when it fails

| Error word / shape you see | Meaning | Action |
|---|---|---|
| `ModuleFederationError` with "shared identity mismatch" (or the plugin's `mf-manifest.json` reports an older `pluginVersion` than the host) | plugin bundle built against a different `@module-federation/runtime`, or missing a `shared[]` dep the host requires | rebuild + redeploy that one plugin (`cd plugins/<key> && bos plugin publish <key>`); confirm with `bos mf check`. Stop editing code — this is a build/deploy problem |
| `No valid plugin constructor found for '<id>'` / `missing the required 'binding' property` | the remote module's export was not created by `createPlugin()` | `export default createPlugin({...})` from `src/index.ts`, rebuild |
| `PluginRuntimeError` with operation `validate-config` or `validate-secrets` and a Zod cause | runtime config violates the plugin's `variables`/`secrets` schemas (secrets hydrate into variables, then re-validate) | fix `plugin.dev.ts` in dev, or the runtime config entry; read the Zod issue paths in the error |
| `Plugin ID '<id>' not found in registry.` | registry key mismatch | align the key used with the plugins/ directory key and package.json `name` |
| 401 `UNAUTHORIZED` with data `{ apiKeyProvided: boolean, ... }` | no session or API key reached the handler (see `every-plugin/errors`) | caller-side problem — sign in or send `x-api-key`; do not catch it in the plugin |
| 503 `SERVICE_UNAVAILABLE` / 502 `CONNECTION_ERROR` shapes from `every-plugin/errors` | upstream dependency of the service failed | surface them via `.errors(...)` on the contract, not ad-hoc ORPCError codes |
