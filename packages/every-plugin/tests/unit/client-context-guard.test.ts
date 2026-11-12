import { oc } from "@orpc/contract";
import { Effect, Layer } from "effect";
import { createPlugin, createPluginRuntime } from "every-plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const TEST_CONFIG = { variables: { baseUrl: "http://localhost:1337" }, secrets: {} };

const contract = oc.router({
  ping: oc.route({ method: "GET", path: "/ping" }).output(z.object({ ok: z.boolean() })),
});

function definePlugin(context?: z.ZodObject<any>) {
  return createPlugin({
    variables: z.object({ baseUrl: z.string() }),
    secrets: z.object({}),
    context,
    contract,
    initialize: () => Effect.succeed(Layer.empty as never),
    createRouter: (builder) => ({
      ping: builder.ping.handler(async () => ({ ok: true })),
    }),
  });
}

const RequiredContextPlugin = definePlugin(
  z.object({ reqHeaders: z.record(z.string(), z.string()), userRef: z.string() }),
);
const OptionalContextPlugin = definePlugin(
  z.object({ reqHeaders: z.record(z.string(), z.string()).optional() }),
);
const ContextlessPlugin = definePlugin();

const registry = {
  guarded: { module: RequiredContextPlugin },
  optional: { module: OptionalContextPlugin },
  contextless: { module: ContextlessPlugin },
};

describe("client context construction guard (dev warning)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns naming the missing keys when created without context", async () => {
    const runtime = createPluginRuntime({ registry, secrets: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = await runtime.usePlugin("guarded", TEST_CONFIG);
    plugin.createClient();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/guarded\.client/);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/reqHeaders/);
  });

  it("warns when only unrelated keys are provided", async () => {
    const runtime = createPluginRuntime({ registry, secrets: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = await runtime.usePlugin("guarded", TEST_CONFIG);
    plugin.createClient({ userId: "u1" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/reqHeaders/);
  });

  it("does not warn when required keys are present", async () => {
    const runtime = createPluginRuntime({ registry, secrets: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = await runtime.usePlugin("guarded", TEST_CONFIG);
    plugin.createClient({ reqHeaders: { "x-api-key": "k" }, userRef: "u1" });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn for optional or undeclared context", async () => {
    const runtime = createPluginRuntime({ registry, secrets: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const optional = await runtime.usePlugin("optional", TEST_CONFIG);
    const contextless = await runtime.usePlugin("contextless", TEST_CONFIG);
    optional.createClient();
    contextless.createClient();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once per plugin and missing-key combination", async () => {
    const runtime = createPluginRuntime({ registry, secrets: {} });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = await runtime.usePlugin("guarded", TEST_CONFIG);
    plugin.createClient();
    plugin.createClient();

    expect(warnSpy).toHaveBeenCalledTimes(1);

    plugin.createClient({ userRef: "u1" });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
