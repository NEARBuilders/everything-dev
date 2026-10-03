import { oc } from "@orpc/contract";
import { call } from "@orpc/server";
import { Context, Effect, Layer } from "effect";
import { buildScoped, buildScopedContext, createPlugin, createPluginRuntime } from "every-plugin";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const testContract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(z.object({ ok: z.boolean() })),
});

describe("Scope lifecycle", () => {
  it("Layer returned from initialize persists after plugin initialization", async () => {
    let released = false;

    class TestTag extends Context.Service<TestTag, { value: string }>()("TestTag") {}

    const TestLive = Layer.effect(
      TestTag,
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => ({ value: "live" })),
          () =>
            Effect.sync(() => {
              released = true;
            }),
        );
        return { value: "live" };
      }),
    );

    const testPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () => Effect.succeed(TestLive),
      createRouter: (builder) => ({
        ping: builder.ping.effect(function* () {
          const svc = yield* TestTag;
          return { ok: svc.value === "live" };
        }),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "scope-test": { module: testPlugin } },
      secrets: {},
    });

    const result = await runtime.usePlugin("scope-test", {
      variables: {},
      secrets: {},
    });

    expect(result).toBeDefined();
    expect(released).toBe(false);

    const client = result.createClient();
    expect(await client.ping()).toEqual({ ok: true });

    await runtime.shutdown();

    expect(released).toBe(true);
  });

  it("acquireRelease resources persist after plugin initialization", async () => {
    let released = false;

    const testPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => ({ connected: true })),
            () =>
              Effect.sync(() => {
                released = true;
              }),
          );
          return Layer.empty as never;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "scope-test": { module: testPlugin } },
      secrets: {},
    });

    const result = await runtime.usePlugin("scope-test", {
      variables: {},
      secrets: {},
    });

    expect(result).toBeDefined();
    expect(released).toBe(false);

    await runtime.shutdown();

    expect(released).toBe(true);
  });

  it("independent plugins have independent scopes", async () => {
    const releases: string[] = [];

    function makePlugin(id: string) {
      return createPlugin({
        variables: z.object({}),
        secrets: z.object({}),
        contract: testContract,
        initialize: () =>
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() => ({ id })),
              () =>
                Effect.sync(() => {
                  releases.push(id);
                }),
            );
            return Layer.empty as never;
          }),
        createRouter: (builder) => ({
          ping: builder.ping.handler(async () => ({ ok: true })),
        }),
      });
    }

    const runtime = createPluginRuntime({
      registry: {
        a: { module: makePlugin("a") },
        b: { module: makePlugin("b") },
      },
      secrets: {},
    });

    await runtime.usePlugin("a", { variables: {}, secrets: {} });
    await runtime.usePlugin("b", { variables: {}, secrets: {} });

    expect(releases).toEqual([]);

    await runtime.shutdown();

    expect(releases).toHaveLength(2);
    expect(releases).toContain("a");
    expect(releases).toContain("b");
  });

  it("runtime.shutdown() cleans up all registered plugins", async () => {
    const shutdownLog: string[] = [];

    const testPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => ({ ready: true })),
            () =>
              Effect.sync(() => {
                shutdownLog.push("released");
              }),
          );
          return Layer.empty as never;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "shutdown-test": { module: testPlugin } },
      secrets: {},
    });

    await runtime.usePlugin("shutdown-test", {
      variables: {},
      secrets: {},
    });

    await runtime.shutdown();

    expect(shutdownLog).toContain("released");
  });

  it("closes an evicted plugin scope", async () => {
    let released = false;

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed({ ready: true }), () =>
            Effect.sync(() => {
              released = true;
            }),
          );
          return Layer.empty as never;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true as const })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "evict-shutdown-defect": { module: failPlugin } },
      secrets: {},
    });

    await runtime.usePlugin("evict-shutdown-defect", { variables: {}, secrets: {} });
    await runtime.evictPlugin("evict-shutdown-defect", { variables: {}, secrets: {} });

    expect(released).toBe(true);

    await runtime.shutdown();
  });

  it("closes registered plugin scopes on runtime cleanup", async () => {
    let released = false;

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed({ ready: true }), () =>
            Effect.sync(() => {
              released = true;
            }),
          );
          return Layer.empty as never;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true as const })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "cleanup-shutdown-defect": { module: failPlugin } },
      secrets: {},
    });

    await runtime.usePlugin("cleanup-shutdown-defect", { variables: {}, secrets: {} });
    await runtime.shutdown();

    expect(released).toBe(true);
  });

  it("initialization failure closes the plugin scope immediately", async () => {
    let released = false;

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() => ({ ready: true })),
            () =>
              Effect.sync(() => {
                released = true;
              }),
          );
          return yield* Effect.fail(new Error("intentional init failure"));
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true as const })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "fail-scope": { module: failPlugin } },
      secrets: {},
    });

    const err = await runtime
      .usePlugin("fail-scope", { variables: {}, secrets: {} })
      .catch((e) => e);
    expect(err._tag).toBe("PluginRuntimeError");

    expect(released).toBe(true);

    await runtime.shutdown();
  });

  it("closes the plugin scope when initialization dies", async () => {
    let released = false;

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed({ ready: true }), () =>
            Effect.sync(() => {
              released = true;
            }),
          );
          return yield* Effect.die(new Error("intentional defect"));
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true as const })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "defect-scope": { module: failPlugin } },
      secrets: {},
    });

    await runtime.usePlugin("defect-scope", { variables: {}, secrets: {} }).catch(() => {});

    expect(released).toBe(true);

    await runtime.shutdown();
  });

  it("closes the plugin scope when initialization is interrupted", async () => {
    let released = false;

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed({ ready: true }), () =>
            Effect.sync(() => {
              released = true;
            }),
          );
          return yield* Effect.interrupt;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true as const })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "interrupt-scope": { module: failPlugin } },
      secrets: {},
    });

    await runtime.usePlugin("interrupt-scope", { variables: {}, secrets: {} }).catch(() => {});

    expect(released).toBe(true);

    await runtime.shutdown();
  });

  it("fails initialization but retries successfully on next call", async () => {
    let callCount = 0;

    const retryPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          callCount++;
          if (callCount < 3) {
            return yield* Effect.fail(new Error(`transient failure #${callCount}`));
          }
          return Layer.empty as never;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "retry-plugin": { module: retryPlugin } },
      secrets: {},
    });

    // First call fails — PluginRuntimeError carries the message in .cause
    const err1 = await runtime
      .usePlugin("retry-plugin", { variables: {}, secrets: {} })
      .catch((e) => e);
    expect(err1._tag).toBe("PluginRuntimeError");
    expect(err1.operation).toBe("initialize-plugin");
    expect(err1.cause?.message).toContain("transient failure #1");
    expect(callCount).toBe(1);

    // Second call fails too — failure entry was evicted, so it retries
    const err2 = await runtime
      .usePlugin("retry-plugin", { variables: {}, secrets: {} })
      .catch((e) => e);
    expect(err2._tag).toBe("PluginRuntimeError");
    expect(err2.cause?.message).toContain("transient failure #2");
    expect(callCount).toBe(2);

    // Third call succeeds
    const result = await runtime.usePlugin("retry-plugin", { variables: {}, secrets: {} });
    expect(result).toBeDefined();
    expect(callCount).toBe(3);

    await runtime.shutdown();
  });

  it("evicts a failed in-flight initialization without rethrowing", async () => {
    let startedResolve!: () => void;
    let rejectInitialization!: (error: Error) => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const initialization = new Promise<never>((_resolve, reject) => {
      rejectInitialization = reject;
    });

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.tryPromise({
          try: async () => {
            startedResolve();
            return await initialization;
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(Effect.map(() => Layer.empty as never)),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true as const })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "evict-failure": { module: failPlugin } },
      secrets: {},
    });

    const result = runtime
      .usePlugin("evict-failure", { variables: {}, secrets: {} })
      .catch((error) => error);
    await started;

    const eviction = runtime.evictPlugin("evict-failure", { variables: {}, secrets: {} });
    rejectInitialization(new Error("intentional in-flight failure"));

    await expect(eviction).resolves.toBeUndefined();
    expect((await result)._tag).toBe("PluginRuntimeError");

    await runtime.shutdown();
  });

  it("constructs the router once per plugin instance", async () => {
    let routerCallCount = 0;

    const countPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      createRouter: (builder) => {
        routerCallCount++;
        return {
          ping: builder.ping.handler(async () => ({ ok: true })),
        };
      },
    });

    const runtime = createPluginRuntime({
      registry: { "router-count": { module: countPlugin } },
      secrets: {},
    });

    const result = await runtime.usePlugin("router-count", {
      variables: {},
      secrets: {},
    });

    const secondResult = await runtime.usePlugin("router-count", {
      variables: {},
      secrets: {},
    });

    // router should be constructed exactly once
    expect(routerCallCount).toBe(1);
    expect(secondResult.router).toBe(result.router);

    // createClient should not call createRouter again
    const client = result.createClient();
    expect(client).toBeDefined();
    expect(routerCallCount).toBe(1);

    // Second createClient still reuses the same router
    const client2 = result.createClient();
    expect(client2).toBeDefined();
    expect(routerCallCount).toBe(1);

    await runtime.shutdown();
  });

  it("initializes once for structurally-equal configs and shares the instance", async () => {
    let initCount = 0;

    const countingPlugin = createPlugin({
      variables: z.object({ url: z.string() }),
      secrets: z.object({ token: z.string() }),
      contract: testContract,
      initialize: () =>
        Effect.sync(() => {
          initCount++;
          return Layer.empty as never;
        }),
      createRouter: (builder) => ({
        ping: builder.ping.handler(async () => ({ ok: true })),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "init-count": { module: countingPlugin } },
      secrets: {},
    });

    const first = await runtime.usePlugin("init-count", {
      variables: { url: "https://example.test" },
      secrets: { token: "secret" },
    });

    const second = await runtime.usePlugin("init-count", {
      variables: { url: "https://example.test" },
      secrets: { token: "secret" },
    });

    expect(initCount).toBe(1);
    expect(second.initialized).toBe(first.initialized);
    expect(second.router).toBe(first.router);

    const third = await runtime.usePlugin("init-count", {
      variables: { url: "https://other.test" },
      secrets: { token: "secret" },
    });

    expect(initCount).toBe(2);
    expect(third.initialized).not.toBe(first.initialized);

    await runtime.shutdown();
  });

  it("closes an initialized scope when router construction fails", async () => {
    let released = false;

    const failPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed({ ready: true }), () =>
            Effect.sync(() => {
              released = true;
            }),
          );
          return Layer.empty as never;
        }),
      createRouter: () => {
        throw new Error("intentional router failure");
      },
    });

    const runtime = createPluginRuntime({
      registry: { "router-failure": { module: failPlugin } },
      secrets: {},
    });

    await runtime.usePlugin("router-failure", { variables: {}, secrets: {} }).catch(() => {});

    expect(released).toBe(true);

    await runtime.shutdown();
  });

  it("provides the built Layer's services to .effect() handlers", async () => {
    class Counter extends Context.Service<Counter, { increment: Effect.Effect<number> }>()(
      "effect-services/Counter",
    ) {
      static Live = Layer.effect(
        Counter,
        Effect.sync(() => {
          let n = 0;
          return {
            increment: Effect.sync(() => ++n),
          };
        }),
      );
    }

    const svcContract = oc.router({
      next: oc.route({ method: "GET", path: "/next" }).output(z.number()),
    });

    const svcPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: svcContract,
      initialize: () => Effect.succeed(Counter.Live),
      createRouter: (builder) => ({
        next: builder.next.effect(function* () {
          const counter = yield* Counter;
          return yield* counter.increment;
        }),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "effect-services": { module: svcPlugin } },
      secrets: {},
    });

    const result = await runtime.usePlugin("effect-services", {
      variables: {},
      secrets: {},
    });

    const client = result.createClient();
    expect(await client.next()).toBe(1);
    expect(await client.next()).toBe(2);

    // raw router call with injected effect context
    expect(
      await call(result.router.next, undefined, {
        context: { "effect/context": result.initialized.effectContext },
      }),
    ).toBe(3);

    await runtime.shutdown();
  });

  it("passes sibling plugin entries to createRouter for merging", async () => {
    const innerContract = oc.router({
      hello: oc.route({ method: "GET", path: "/inner/hello" }).output(z.string()),
    });
    const innerPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: innerContract,
      createRouter: (builder) => ({
        hello: builder.hello.handler(async () => "inner-hello"),
      }),
    });

    const outerContract = oc.router({
      ping: oc.route({ method: "GET", path: "/outer/ping" }).output(z.string()),
    });
    let receivedPlugins: unknown = null;
    const outerPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: outerContract,
      createRouter: (builder, plugins) => {
        receivedPlugins = plugins;
        return {
          ping: builder.ping.handler(async () => "outer-ping"),
          inner: (plugins as any).inner.router,
        };
      },
    });

    const runtime = createPluginRuntime({
      registry: {
        inner: { module: innerPlugin },
        outer: { module: outerPlugin },
      },
      secrets: {},
    });

    const inner = await runtime.usePlugin("inner", { variables: {}, secrets: {} });
    const plugins = {
      inner: { client: inner.createClient, router: inner.router },
    };

    const outer = await runtime.usePlugin("outer", { variables: {}, secrets: {} }, plugins);

    expect(receivedPlugins).toBe(plugins);

    const client = outer.createClient();
    expect(await client.ping()).toBe("outer-ping");
    expect(await (client as any).inner.hello()).toBe("inner-hello");

    await runtime.shutdown();
  });

  it("buildScoped yields the service and releases resources when the surrounding scope closes", async () => {
    let released = false;

    class TrackedTag extends Context.Service<TrackedTag, { value: string }>()(
      "scope-lifecycle/TrackedTag",
    ) {}

    const TrackedLive = Layer.effect(
      TrackedTag,
      Effect.acquireRelease(
        Effect.sync(() => ({ value: "live" })),
        () =>
          Effect.sync(() => {
            released = true;
          }),
      ),
    );

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* buildScoped(TrackedTag, TrackedLive);
          return service.value;
        }),
      ),
    );

    expect(result).toBe("live");
    expect(released).toBe(true);
  });

  it("buildScoped keeps the layer's R requirements on the effect", async () => {
    class NeedsConfig extends Context.Service<NeedsConfig, { url: string }>()(
      "scope-lifecycle/NeedsConfig",
    ) {}

    class ConfigTag extends Context.Service<ConfigTag, { url: string }>()(
      "scope-lifecycle/ConfigTag",
    ) {}

    const ConfigLive = Layer.succeed(ConfigTag, { url: "https://example.test" });
    const NeedsConfigLive = Layer.effect(
      NeedsConfig,
      Effect.gen(function* () {
        const config = yield* ConfigTag;
        return { url: config.url };
      }),
    );

    const result = await Effect.runPromise(
      Effect.scoped(buildScoped(NeedsConfig, NeedsConfigLive.pipe(Layer.provide(ConfigLive)))),
    );

    expect(result.url).toBe("https://example.test");
  });

  it("buildScopedContext resolves two tags from one built context", async () => {
    class ATag extends Context.Service<ATag, { a: number }>()("scope-lifecycle/ATag") {}
    class BTag extends Context.Service<BTag, { b: number }>()("scope-lifecycle/BTag") {}

    const { a, b } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const services = yield* buildScopedContext(
            Layer.mergeAll(Layer.succeed(ATag, { a: 1 }), Layer.succeed(BTag, { b: 2 })),
          );
          return {
            a: Context.get(services, ATag).a,
            b: Context.get(services, BTag).b,
          };
        }),
      ),
    );

    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});
