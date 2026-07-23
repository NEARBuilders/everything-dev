import { createPlugin, createPluginRuntime } from "every-plugin";
import { Context, Effect, Layer } from "every-plugin/effect";
import { oc } from "every-plugin/orpc";
import { z } from "every-plugin/zod";
import { describe, expect, it } from "vitest";

const testContract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(z.object({ ok: z.boolean() })),
});

describe("Scope lifecycle", () => {
  it("tools.buildService resources persist after plugin initialization", async () => {
    let released = false;

    class TestTag extends Context.Tag("TestTag")<TestTag, { value: string }>() {}

    const TestLive = Layer.scoped(
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
      initialize: (_config, _plugins, tools) =>
        Effect.gen(function* () {
          const svc = yield* tools.buildService(TestTag, TestLive);
          return { svc };
        }),
      createRouter: (_deps, builder) => ({
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
          return { ready: true };
        }),
      createRouter: (_deps, builder) => ({
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
            return { id };
          }),
        createRouter: (_deps, builder) => ({
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
          return { ready: true };
        }),
      shutdown: () =>
        Effect.sync(() => {
          shutdownLog.push("shutdown");
        }),
      createRouter: (_deps, builder) => ({
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
    expect(shutdownLog.indexOf("shutdown")).toBeLessThanOrEqual(shutdownLog.indexOf("released"));
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
      createRouter: () => ({}),
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
          return { ready: true };
        }),
      createRouter: (_deps, builder) => ({
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

  it("constructs the router once per plugin instance", async () => {
    let routerCallCount = 0;

    const countPlugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      contract: testContract,
      initialize: () => Effect.succeed({ ready: true }),
      createRouter: (_deps, builder) => {
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

    // router should be constructed exactly once
    expect(routerCallCount).toBe(1);

    // createClient should not call createRouter again
    const client = result.createClient({});
    expect(client).toBeDefined();
    expect(routerCallCount).toBe(1);

    // Second createClient still reuses the same router
    const client2 = result.createClient({});
    expect(client2).toBeDefined();
    expect(routerCallCount).toBe(1);

    await runtime.shutdown();
  });
});
