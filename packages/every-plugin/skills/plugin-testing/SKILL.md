---
name: plugin-testing
description: Test every-plugin modules with vitest and the plugin runtime. Use when writing or modifying plugin tests under plugins/*/src/__tests__/ or plugins/*/tests/.
metadata:
  sources: "src/index.ts,src/runtime/index.ts"
---

# every-plugin Testing

## Test Structure

```
plugins/your-plugin/
├── src/__tests__/
│   ├── integration.test.ts   # Full plugin lifecycle via runtime
│   └── unit.test.ts          # Service class in isolation
└── vitest.config.ts
```

## Unit Tests (Service Only)

Test the service class directly without the plugin runtime:

```typescript
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { MyService } from "../service";

describe("MyService", () => {
  const service = new MyService("https://api.example.com", "test-key");

  it("ping returns ok", async () => {
    const result = await Effect.runPromise(service.ping());
    expect(result.status).toBe("ok");
  });

  it("getById returns item", async () => {
    const result = await Effect.runPromise(service.getById("item-1"));
    expect(result.item.id).toBe("item-1");
  });

  it("getById throws on missing item", async () => {
    await expect(Effect.runPromise(service.getById("missing"))).rejects.toThrow();
  });
});
```

## Integration Tests (Plugin Runtime)

Test the full plugin lifecycle — initialization, router execution, shutdown:

```typescript
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPluginRuntime } from "every-plugin";
import Plugin from "../index";

describe("MyPlugin integration", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;
  let client: any;

  beforeAll(async () => {
    runtime = createPluginRuntime({
      registry: {
        "my-plugin": { module: Plugin },
      },
    });
    const result = await runtime.usePlugin("my-plugin", {
      variables: { baseUrl: "https://api.example.com" },
      secrets: { apiKey: "test-key" },
    });
    client = result.createClient();
  });

  afterAll(async () => {
    await runtime.shutdown();
  });

  it("ping responds", async () => {
    const result = await client.ping();
    expect(result.status).toBe("ok");
  });

  it("getById returns item", async () => {
    const result = await client.getById({ id: "item-1" });
    expect(result.item.id).toBe("item-1");
  });

  it("getById without auth throws UNAUTHORIZED", async () => {
    await expect(client.getById({ id: "item-1" })).rejects.toThrow();
  });
});
```

## Testing Plugin Composition

When testing an API plugin that uses `withPlugins`, mock the `pluginsClient`:

```typescript
import { createPluginRuntime } from "every-plugin";
import ApiPlugin from "../index";

const mockRegistryClient = {
  getRegistryStatus: vi.fn().mockResolvedValue({ status: "ok" }),
  listRegistryApps: vi.fn().mockResolvedValue({ apps: [] }),
};

describe("API with mock registry", () => {
  it("pluginDemo returns composed data", async () => {
    const runtime = createPluginRuntime({
      registry: {
        api: { module: ApiPlugin },
      },
    });
    const result = await runtime.usePlugin(
      "api",
      { variables: {}, secrets: {} },
      { registry: () => mockRegistryClient },
    );
    const client = result.createClient();
    const data = await client.pluginDemo();
    expect(data.registryStatus.status).toBe("ok");
    await runtime.shutdown();
  });
});
```

## Testing Scope Lifecycle

When a plugin uses `buildScoped(...)` inside `initialize`, verify that scoped resources persist after initialization and are released during shutdown:

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlugin, createPluginRuntime } from "every-plugin";
import { Context, Effect, Layer } from "effect";

let released = false;

class TestTag extends Context.Service<TestTag, { value: string }>()("TestTag") {}

const TestLive = Layer.effect(
  TestTag,
  Effect.acquireRelease(
    Effect.sync(() => ({ value: "live" })),
    () =>
      Effect.sync(() => {
        released = true;
      }),
  ),
);

describe("scope lifecycle", () => {
  let runtime: ReturnType<typeof createPluginRuntime>;

  beforeAll(async () => {
    const plugin = createPlugin({
      // ... variables, secrets, contract ...
      initialize: () =>
        Effect.succeed(
          TestLive,
        ),
      createRouter: (builder) => ({
        // ... routes ...
      }),
    });

    runtime = createPluginRuntime({
      registry: { "lifecycle-test": { module: plugin } },
    });

    await runtime.usePlugin("lifecycle-test", {
      variables: {}, secrets: {},
    });
  });

  it("resource persists after initialization", () => {
    expect(released).toBe(false);
  });

  afterAll(async () => {
    await runtime.shutdown();
    expect(released).toBe(true);
  });
});
```

Key assertions:
- Resource should NOT be released after `usePlugin()` completes
- Resource SHOULD be released after `runtime.shutdown()`
- Multiple independent plugins have independent scope lifetimes
- `runtime.shutdown()` calls cleanup for all registered plugins

## Testing Streaming (eventIterator)

Use `for await` to collect streaming results:

```typescript
it("search streams results", async () => {
  const chunks: any[] = [];
  const stream = await client.search({ query: "test", limit: 5 });
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  expect(chunks.length).toBeGreaterThan(0);
});
```

## Vitest Config

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

## Common Mistakes

- Not calling `runtime.shutdown()` in `afterAll` — leaves plugin scopes/resources running
- Using `vi.fn()` without `.mockResolvedValue()` — unhandled promise rejections
- Forgetting `vite-tsconfig-paths` plugin — package subpath imports like `every-plugin/errors` won't resolve
- Omitting the `registry` object when calling `createPluginRuntime(...)` — the runtime requires explicit plugin entries
- Testing only happy paths — always test error channels (Effect failures, ORPCError throws)
