---
name: plugin-development
description: Build, register, and deploy plugins within everything.dev. Covers the _template scaffold, contract/service/index pattern, database setup with Drizzle, bos.config.json registration, plugin UI/sidebar, and CLI workflow. Use when creating new plugins, adding database-backed routes, or deploying plugins to production.
metadata:
  sources: "plugins/_template/src/index.ts,plugins/_template/src/contract.ts,plugins/_template/src/service.ts,plugins/_template/rspack.config.js,plugins/_template/plugin.dev.ts,plugins/projects/src/db/schema.ts,plugins/projects/src/db/layer.ts,api/src/db/index.ts,api/src/db/migrator.ts,packages/every-plugin/src/plugin.ts"
---

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
import { eventIterator, oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";

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
- Import from `every-plugin/zod`, `every-plugin/orpc`, `every-plugin/errors` — never directly from `zod` or `@orpc/*`
- Path params (`{id}`) automatically bind to Zod input keys
- `.output(eventIterator(Schema))` enables SSE streaming routes
- `.errors(Errors)` enables typed error handling in generated clients

## Step 3: Build Services (`src/service.ts`)

Services are plain classes or functions, optionally using Effect:

```ts
import { Effect } from "every-plugin/effect";

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
import { createPlugin } from "every-plugin";
import { Effect } from "every-plugin/effect";
import { MemoryPublisher, ORPCError } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
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

  initialize: (config) =>
    Effect.gen(function* () {
      const service = new TemplateService(config.variables.baseUrl, config.secrets.apiKey, config.variables.timeout);
      yield* service.ping(); // health check on startup

      const publisher = new MemoryPublisher({ resumeRetentionSeconds: 120 });

      return { service, publisher };
    }),

  shutdown: () => Effect.void,

  createRouter: (context, builder) => {
    const { service, publisher } = context;
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

**`variables`** — Public config exposed in `bos.config.json` (typed, with defaults).  
**`secrets`** — Private values from `process.env` (typed, dev defaults).  
**`context`** — Per-request context injected by the host. See "Request Context Reference" below for all available fields.  
**`initialize`** — Effect-based startup. Create services, publishers, DB connections. Return value is passed as `context` to `createRouter`.  
**`createRouter`** — Maps contract procedures to handlers. Receives the value returned by `initialize` plus a pre-configured `builder`.

## Request Context Reference

The host injects a per-request context object into every plugin. The plugin **must declare the fields it uses** in its context zod schema. Only declared fields are available to route handlers and middleware:

```ts
context: z.object({
  userId: z.string().optional(),
  user: z.object({
    id: z.string(),
    role: z.string().optional(),   // "admin", "member", or null for anon
    email: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  organizationId: z.string().optional(),   // Active organization UUID
  organization: z.object({
    activeOrganizationId: z.string().nullable().optional(),
    organization: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      logo: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),  // daoAccountId lives here
    }).nullable().optional(),
    member: z.object({
      id: z.string(),
      role: z.string(),   // User's role within this org ("admin", "member")
    }).nullable().optional(),
    isPersonal: z.boolean(),
    hasOrganization: z.boolean(),
  }).optional(),
  near: z.object({
    primaryAccountId: z.string().nullable(),
    linkedAccounts: z.array(z.object({
      accountId: z.string(),
      network: z.string(),
      publicKey: z.string(),
      isPrimary: z.boolean(),
    })),
    hasNearAccount: z.boolean(),
  }).optional(),
  walletAddress: z.string().optional(),
  apiKey: z.object({
    id: z.string(),
    name: z.string().nullable().optional(),
    permissions: z.record(z.string(), z.array(z.string())).nullable().optional(),
  }).optional(),
  reqHeaders: z.custom<Headers>().optional(),
  getRawBody: z.custom<() => Promise<string>>().optional(),
}),
```

The zod schema is a filter — the host passes all fields, but your plugin only sees what you declare. For pre-built auth/organization middleware, see the `api-and-auth` skill.

## Step 5: Register in `bos.config.json`

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

The CLI updates `bos.config.json` automatically when you run `bos plugin add` / `bos plugin remove`.

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

```ts
// src/db/layer.ts
import { Effect, Layer } from "every-plugin/effect";
import { createDatabaseDriver } from "./index";

export class DatabaseTag extends Context.Tag("plugins/your-plugin/Database")<
  DatabaseTag,
  { db: any; close: () => Promise<void> }
>() {}

export function DatabaseLive(url: string) {
  return Layer.scoped(
    DatabaseTag,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const driver = await createDatabaseDriver(url);
        return driver;
      }),
      (driver) => Effect.promise(() => driver.close()),
    ),
  );
}
```

### Migration Generation

1. Create `drizzle.config.ts` in your plugin directory
2. Run `drizzle-kit generate` to produce SQL migration files
3. Store migrations in `src/db/migrations/`
4. Use the custom `migrate()` function during `initialize`. Pass an explicit
   `storage` resolved from the workspace so the journal slug is reliable
   under rspack/Module Federation bundling (the no-arg fallback reads
   `npm_package_name`, which is unreliable in bundled remotes):

```ts
initialize: (config) =>
  Effect.gen(function* () {
    const driver = yield* DatabaseLive(config.secrets.DATABASE_URL);
    // Or load and apply migrations directly:
    const { loadMigrations } = yield* Effect.promise(() => import("./db/load-migrations"));
    const { migrate } = yield* Effect.promise(() => import("./db/migrator"));
    const { getMigrationSlug, getMigrationStorage } = yield* Effect.promise(
      () => import("everything-dev/db"),
    );
    const storage = getMigrationStorage(getMigrationSlug(import.meta.dirname));
    const migrations = yield* loadMigrations();
    yield* migrate(driver.db, migrations, storage);

    return { db: driver.db, ... };
  }),
```

### Per-Plugin Isolation

Each plugin manages its own database or schema. Connection strings are passed via secrets (`YOURPLUGIN_DATABASE_URL`). The convention:

```
YOURPLUGIN_DATABASE_URL=pglite:.bos/your-plugin/:memory:
```

In production, set this to a real PostgreSQL connection string in the host's environment.

## Calling Other Plugins

Use `createPlugin.withPlugins<PluginsClient>()` to get typed access to other plugin factories. The `plugins-client.gen.ts` file provides the `PluginsClient` type. Regenerate with `bos types gen`.

## Plugin UI

Add a UI remote via the `ui` field in `bos.config.json`. Sidebar items are defined manually in `ui/src/routes/_layout.tsx`.

## Deploy

```bash
bos plugin publish          # Build and publish just this plugin
bos publish --deploy        # Build ALL packages + deploy + publish config
```

Deploy builds via `rspack.config.js`, uploads to Zephyr CDN, updates `bos.config.json` with production URL + integrity hash, and publishes to FastKV registry. Restart the host after publishing.

### CLI Lifecycle

1. `cp -r plugins/_template plugins/your-plugin` then edit names
2. Register in `bos.config.json` (or `bos plugin add`)
3. `bos types gen`
4. `bos dev` to develop
5. `bos plugin publish` to deploy
