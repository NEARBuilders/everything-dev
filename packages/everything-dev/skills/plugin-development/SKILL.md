---
name: plugin-development
description: Build, register, and deploy plugins within everything.dev. Covers the _template scaffold, contract/service/index pattern, database setup with Drizzle, authored-config registration, plugin UI/sidebar, and CLI workflow. Use when creating new plugins, adding database-backed routes, or deploying plugins to production.
metadata:
  sources: "plugins/_template/src/index.ts,plugins/_template/src/contract.ts,plugins/_template/src/service.ts,packages/every-plugin/src/build/rspack,plugins/_template/plugin.dev.ts,plugins/_template/src/db/schema.ts,plugins/_template/src/db/layer.ts,api/src/db/index.ts,api/src/db/migrate.ts,packages/every-plugin/src/plugin.ts,packages/everything-dev/src/cli.ts"
---

> **Config form:** the authored config is `bos.app.ts` (canonical, preferred when both exist). A legacy `bos.config.json` is still supported for older children. Where this doc says `bos.config.json` for the *local authored file*, read "the authored config". The published artifact on FastKV keeps the key name `bos.config.json`.

# Plugin Development

## Plugin Structure

```
plugins/your-plugin/
├── src/
│   ├── contract.ts          # oRPC route definitions + Zod schemas
│   ├── service.ts           # Business logic (class or plain functions)
│   ├── index.ts             # createPlugin() wiring
│   ├── db/                  # Optional: database schema + migrations
│   │   ├── schema.ts
│   │   ├── layer.ts
│   │   ├── migrator.ts
│   │   └── migrations/
│   ├── plugins-client.gen.ts  # Generated — in-process plugin client types
│   └── __tests__/            # Tests
├── package.json
├── rspack.config.js          # Build config
├── plugin.dev.ts             # Dev server (port, variables, secrets)
└── tsconfig.json
```

## Step 1: Copy from `_template`

The quickest start is to copy the template:

```bash
cp -r plugins/_template plugins/your-plugin
```

Then rename in `package.json`, `plugin.dev.ts`, and `rspack.config.js`.

Or use the CLI (no automated command yet — copy template manually).

## Step 2: Define the Contract (`src/contract.ts`)

Use `oc.router()` to define typed routes. Each route has a method, path, optional input/output schemas, and optional error declarations:

```ts
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

// Define errors this plugin throws
const Errors = {
  NOT_FOUND: { status: 404, message: "Item not found" },
  UNAUTHORIZED: { status: 401, message: "User ID required" },
};

export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
});

export const contract = oc.router({
  getById: oc
    .route({ method: "GET", path: "/items/{id}" })
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ item: ItemSchema, userId: z.string() }))
    .errors(Errors),

  ping: oc
    .route({ method: "GET", path: "/ping" })
    .output(z.object({ status: z.literal("ok"), timestamp: z.string().datetime() })),

  search: oc
    .route({ method: "GET", path: "/search" })
    .input(z.object({ query: z.string(), limit: z.number().min(1).max(100).default(10) }))
    .output(eventIterator(SearchResultSchema)),  // SSE streaming

  enqueueBackground: oc
    .route({ method: "POST", path: "/background/events" })
    .input(z.object({ id: z.string().optional() }))
    .output(z.object({ ok: z.boolean() })),
});

export type ContractType = typeof contract;
```

Key rules:
- Import `z` from `zod`, `oc`/`eventIterator` from `@orpc/contract`, and `Effect`/`Layer` from `effect` directly — the `every-plugin/zod`, `every-plugin/orpc`, and `every-plugin/effect` facade barrels were deleted. Use `every-plugin/errors` for the shared error shapes
- Path params (`{id}`) automatically bind to Zod input keys
- `.output(eventIterator(Schema))` enables SSE streaming routes
- `.errors(Errors)` enables typed error handling in generated clients

## Step 3: Build Services (`src/service.ts`)

Services are plain classes or functions, optionally using Effect:

```ts
import { Effect } from "effect";

export class TemplateService {
  constructor(
    private baseUrl: URL,
    private apiKey: string,
    private timeout: number,
  ) {}

  ping(): Effect.Effect<{ status: string; timestamp: string }> {
    return Effect.succeed({ status: "ok", timestamp: new Date().toISOString() });
  }

  getById(id: string): Effect.Effect<{ id: string; title: string; createdAt: string }> {
    return Effect.tryPromise(async () => {
      const res = await fetch(`${this.baseUrl}/items/${id}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!res.ok) throw new Error("Item not found");
      return res.json();
    });
  }
}
```

Use `Effect.runPromise(service.method())` to bridge Effect and async handlers in `createRouter`.

## Step 4: Wire with `createPlugin` (`src/index.ts`)

```ts
import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import type { PluginsClient } from "./plugins-client.gen";
import { TemplateService } from "./service";

export default createPlugin.withPlugins<PluginsClient>()({
  variables: z.object({
    baseUrl: z.url().default("https://api.example.com"),
    timeout: z.number().min(1000).max(60000).default(10000),
  }),

  secrets: z.object({
    apiKey: z.string().min(1).default("dev-key"),
  }),

  context: z.object({
    userId: z.string().optional(),
    user: z.object({
      id: z.string(),
      role: z.string().optional(),
      email: z.string().optional(),
      name: z.string().optional(),
    }).optional(),
    reqHeaders: z.custom<Headers>().optional(),
    getRawBody: z.custom<() => Promise<string>>().optional(),
  }),

  contract,

  initialize: (config, _plugins, tools) =>
    Effect.gen(function* () {
      const service = new TemplateService(config.variables.baseUrl, config.secrets.apiKey, config.variables.timeout);
      yield* service.ping(); // health check on startup

      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 120 });

      // For scoped resources (DB pools, caches, repositories):
      // const repo = yield* buildScoped(MyRepoTag, MyRepoLive.pipe(...))

      return { service, publisher };
    }),

  shutdown: () => Effect.void,

  createRouter: (deps, builder) => {
    const { service, publisher } = deps;
    const requireAuth = builder.middleware(async ({ context, next }) => {
      if (!context.userId) throw new ORPCError("UNAUTHORIZED", { message: "User ID required" });
      return next({ context: { ...context, userId: context.userId } });
    });

    return {
      getById: builder.getById.use(requireAuth).handler(async ({ input, context }) => {
        const item = await Effect.runPromise(service.getById(input.id));
        return { item, userId: context.userId };
      }),

      ping: builder.ping.handler(async () => {
        return await Effect.runPromise(service.ping());
      }),

      search: builder.search.handler(async function* ({ input }) {
        const generator = await Effect.runPromise(service.search(input.query, input.limit));
        for await (const result of generator) yield result;
      }),
    };
  },
});
```

### Thing Provider Pattern

When the API owns the registry but the plugin owns the payload, add a small provider surface to your contract:

```ts
createThing: oc
  .route({ method: "POST", path: "/things" })
  .input(z.object({ thingId: z.string(), payload: z.unknown() }))
  .output(z.object({ type: z.string(), payload: z.unknown(), action: z.string().optional() })),

getThing: oc
  .route({ method: "GET", path: "/things/{thingId}" })
  .input(z.object({ thingId: z.string() }))
  .output(z.object({ type: z.string(), payload: z.unknown() })),
```

In `service.ts`, keep the plugin-specific type derivation close to the data source:

```ts
createThing(thingId: string, payload: unknown) {
  return Effect.sync(() => {
    const type = this.resolveThingType(payload);
    this.things.set(thingId, { thingId, type, payload, createdAt: now, updatedAt: now });
    return { type, payload, action: `${type}.created` };
  });
}
```

Good practice:
- Let the API store only `thingId`, `pluginId`, and timestamps.
- Let the plugin decide the public `type` string and payload shape.
- Use `pluginId` as the API routing key, not as a UI concern.
- Keep `plugins-client.gen.ts` local to the plugin scaffold so `createPlugin.withPlugins<PluginsClient>()` stays typed.

### Key Patterns

**`variables`** — Public config exposed in the authored config (typed, with defaults).  
**`secrets`** — Private values from `process.env` (typed, dev defaults).  
**`context`** — Per-request context injected by the host. See "Request Context Reference" below for all available fields.  
**`initialize`** — Effect-based startup. Return an Effect `Layer`; the runtime builds it against the plugin's lifecycle scope. Use `buildScoped(tag, layer)` (or `buildScopedContext(layer)` for multi-service layers) from `"every-plugin"` to build scoped resources (DB pools, caches, repositories) that live for the plugin's lifetime.  
**`createRouter`** — Maps contract procedures to handlers. Receives the value returned by `initialize` plus a pre-configured `builder`.

## Request Context

The host injects a per-request context object into every plugin. The plugin **must declare the fields it uses** in its context zod schema — the schema is a filter; the host passes all fields, but your plugin only sees what you declare.

Available fields: `userId`, `user` (id, role, email, name), `organizationId` / `organization` (active org envelope, `member.role`, `metadata.daoAccountId`), `near` (primaryAccountId, linkedAccounts), `walletAddress`, `apiKey` (id, name, permissions), `reqHeaders`, `getRawBody`.

See [request-context](references/request-context.md) for the full schema and field table. For pre-built auth/organization middleware, see the `api-and-auth` skill.

## Step 5: Register in the authored config

Add a plugin entry:

```json
{
  "plugins": {
    "your-plugin": {
      "name": "your-plugin",
      "development": "local:plugins/your-plugin",
      "production": "https://cdn.example.com/your-plugin/remoteEntry.js",
      "ssr": "https://cdn.example.com/your-plugin/ssr/remoteEntry.js",
      "variables": {
        "baseUrl": "https://api.example.com",
        "timeout": 5000
      },
      "secrets": ["YOURPLUGIN_API_KEY"],
      "routes": ["ui/src/routes/_layout/_authenticated/your-plugin/**"],
      "shared": {
        "react": { "version": "^19.0.0", "singleton": true },
        "react-dom": { "version": "^19.0.0", "singleton": true }
      }
    }
  }
}
```

The CLI updates the authored config (`bos.app.ts`) automatically when you run `bos plugin add` / `bos plugin remove`.

**Remote-only plugins:** The `development` key is optional. A plugin can be remote-only (just a `production` URL) — the host/API consume it via `pluginsClient` and HTTP, and types resolve from the deployed manifest. Plugin source does not need to live in the consuming repo. This is how plugins maintained in other repos are mounted.

## Step 6: `plugin.dev.ts`

Dev server config for local development:

```ts
import { defineConfig } from "every-plugin/dev";

export default defineConfig({
  port: 3015,
  variables: {
    baseUrl: "https://api.example.com",
    timeout: 10000,
  },
  secrets: {
    apiKey: "dev-key",
  },
});
```

## Step 7: Build Config (`rspack.config.js`)

```js
const { createRspackConfig } = require("every-plugin/rspack");

module.exports = createRspackConfig({
  name: "your-plugin",
  exposes: {
    ".": "./src/index.ts",
    "./contract": "./src/contract.ts",
  },
  plugins: [],
});
```

Key exports:
- `"."` — the plugin entry point (`createPlugin` export)
- `"./contract"` — the contract module (for type generation from remote plugins)

## Database Setup

### Schema (`src/db/schema.ts`)

```ts
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  titleIdx: uniqueIndex("items_title_idx").on(table.title),
}));
```

### Driver (`src/db/index.ts` or use `api/src/db/index.ts`)

```ts
export async function createDatabaseDriver(url: string) {
  // Supports:
  //   "pglite:.bos/your-plugin/:memory:" — in-memory PGlite (dev)
  //   "pglite:.bos/your-plugin/data"      — persistent PGlite (dev)
  //   "<postgres connection string>"      — real PostgreSQL (prod)
  // Returns { db: drizzle client, close(): Promise<void> }
}
```

### Layer Pattern

`DatabaseLive` is a `Layer.scoped` that creates the driver, runs migrations (inside the scoped layer, so the pool stays open for migration queries), and returns the `db`. `acquireRelease` closes the driver on scope release. See [database](references/database.md) for the full implementation.

### Migration Generation

1. Create `drizzle.config.ts` in your plugin directory
2. Run `drizzle-kit generate` to produce SQL migration files
3. Store migrations in `src/db/migrations/` with an explicit `storage` resolved from the workspace (the no-arg fallback reads `npm_package_name`, unreliable under rspack/Module Federation bundling)

Migrations run inside `DatabaseLive`'s scoped layer. The critical rule is to **build the DB-backed service via `buildScoped`** so the scope (and the pool) lives for the plugin's lifetime. Do NOT call `DatabaseLive` directly in `initialize` and extract the driver — that creates a transient scope that releases the pool immediately. See [database](references/database.md) for correct/wrong examples.

### Per-Plugin Isolation

Each plugin manages its own database or schema. Connection strings are passed via secrets (`YOURPLUGIN_DATABASE_URL`). The convention:

```
YOURPLUGIN_DATABASE_URL=pglite:.bos/your-plugin/:memory:
```

In production, set this to a real PostgreSQL connection string in the host's environment.

## Calling Other Plugins

Use `createPlugin.withPlugins<PluginsClient>()` to get typed access to other plugin factories. The `plugins-client.gen.ts` file provides the `PluginsClient` type. Regenerate with `bos types gen`.

## Plugin UI

Add a UI remote via the `ui` field in the authored config. Sidebar items are defined manually in `ui/src/components/layout/nav-items.ts`.

## Deploy

```bash
bos plugin publish          # Build and publish just this plugin
bos publish --deploy        # Build ALL packages + deploy + publish config
```

Builds the plugin, pins the deterministic image-native production URL into the published config (`https://<domain>/bundles/<account>/<gateway>/<key>/`), and publishes to FastKV registry. Restart the host after publishing.

### CLI Lifecycle

1. `cp -r plugins/_template plugins/your-plugin` then edit names
2. Register in the authored config (or `bos plugin add`)
3. `bos types gen`
4. `bos dev` to develop
5. `bos plugin publish` to deploy

## The tasks you will actually be given

**"Add a DB-backed route."** Schema in `src/db/schema.ts` → `drizzle-kit generate` → inside `initialize`, build the repo with `buildScoped(RepoTag, RepoLive.pipe(Layer.provide(DatabaseLive(config.secrets.YOURPLUGIN_DATABASE_URL))))` → handler is `.effect(function* ...)` and does `yield* RepoTag`.

**"Register and deploy a new plugin."** `bos plugin add local:plugins/your-plugin` (writes the authored config + regenerates types) → `pnpm run typecheck` → `bos plugin publish your-plugin` → restart the host.

**"Expose a service to the host, not just oRPC."** Set `servicesTag` on the plugin definition — handlers keep accessing it with `yield* Tag` as normal.

## What comes back when it fails

| word | do |
|---|---|
| pool dead / connection released right after startup | a transient scope — you extracted the driver instead of building the service via `buildScoped(...)` inside `initialize`; rebuild it that way (see [database](references/database.md)) |
| `ModuleFederationError` / `__webpack_modules__[e].call` in the browser | the deployed `mf-manifest.json` is older than the host's federation runtime — `bos mf check`, then `bos plugin publish <key>`, restart the host |
| migration never runs | migrations execute inside `DatabaseLive`'s scoped layer at plugin boot — confirm the plugin booted and the `<YOU>_DATABASE_URL` secret resolves |
| handler can't see `context.userId` | the context zod schema is a filter — declare every field you use or the host's value is stripped |
| stale types in `plugins-client.gen.ts` | `bos types gen` (or `pnpm run typecheck`) after editing any contract |
