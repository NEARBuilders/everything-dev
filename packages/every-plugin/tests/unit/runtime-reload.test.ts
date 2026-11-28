import { oc } from "@orpc/contract";
import { Context, Effect, Layer } from "effect";
import { createPlugin, createPluginRuntime } from "every-plugin";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const testContract = oc.router({
  ping: oc
    .route({ method: "GET", path: "/ping" })
    .output(z.object({ ok: z.boolean(), token: z.string() })),
});

class ReloadTag extends Context.Service<ReloadTag, { token: string }>()("test/ReloadTag") {}

describe("PluginRuntime.reloadPlugin (issue #942)", () => {
  it("a reload re-initializes the plugin and releases the previous scope", async () => {
    const events: string[] = [];
    let counter = 0;

    const plugin = createPlugin({
      variables: z.object({}),
      secrets: z.object({}),
      context: z.object({}),
      contract: testContract,
      initialize: () =>
        Effect.gen(function* () {
          counter += 1;
          const token = `gen-${counter}`;
          yield* Effect.acquireRelease(
            Effect.sync(() => events.push(`acquire:${token}`)),
            () => Effect.sync(() => events.push(`release:${token}`)),
          );
          return Layer.succeed(ReloadTag, { token });
        }),
      createRouter: (builder) => ({
        ping: builder.ping.effect(function* () {
          const tag = yield* ReloadTag;
          return { ok: true, token: tag.token };
        }),
      }),
    });

    const runtime = createPluginRuntime({
      registry: { "reload-test": { module: plugin } },
      secrets: {},
    });

    const first = await runtime.usePlugin("reload-test", { variables: {}, secrets: {} });
    expect(events).toEqual(["acquire:gen-1"]);
    const firstClient = first.createClient() as {
      ping: () => Promise<{ ok: boolean; token: string }>;
    };
    expect(await firstClient.ping()).toEqual({ ok: true, token: "gen-1" });

    const second = await runtime.reloadPlugin("reload-test", { variables: {}, secrets: {} });
    expect(events).toEqual(["acquire:gen-1", "acquire:gen-2", "release:gen-1"]);

    const secondClient = second.createClient() as {
      ping: () => Promise<{ ok: boolean; token: string }>;
    };
    expect(await secondClient.ping()).toEqual({ ok: true, token: "gen-2" });

    await runtime.shutdown();
    expect(events[events.length - 1]).toBe("release:gen-2");
  });
});
