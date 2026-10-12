import { oc } from "@orpc/contract";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferenceHandlerPlugin } from "@orpc/openapi/plugins";
import { RPCHandler } from "@orpc/server/fetch";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { createPlugin, createPluginRuntime, startDirectModuleHost } from "every-plugin";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const hostContract = oc.router({
  ping: oc
    .route({
      method: "GET",
      path: "/ping",
      summary: "Ping",
    })
    .output(z.object({ ok: z.boolean(), name: z.string() })),
});

const HostPlugin = createPlugin({
  variables: z.object({}),
  secrets: z.object({}),
  contract: hostContract,
  createRouter: (builder) => ({
    ping: builder.ping.handler(async () => ({ ok: true, name: "direct-host" })),
  }),
});

describe("direct module host", () => {
  const runtime = createPluginRuntime({ registry: { host: { module: HostPlugin } } });

  let host: Awaited<ReturnType<typeof startDirectModuleHost>> | null = null;
  let baseUrl = "";

  beforeAll(async () => {
    const plugin = await runtime.usePlugin("host", { variables: {}, secrets: {} });
    const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });

    host = await startDirectModuleHost({
      name: "host",
      version: "1.0.0",
      port: 0,
      effectContext: () => plugin.initialized.effectContext,
      handlers: {
        rpc: new RPCHandler(plugin.router),
        api: new OpenAPIHandler(plugin.router, {
          plugins: [
            new OpenAPIReferenceHandlerPlugin({
              spec: () => generator.generate(plugin.router, { version: "3.1.1" }),
            }),
          ],
        }),
      },
    });

    baseUrl = `http://127.0.0.1:${host.port}`;
  });

  afterAll(async () => {
    if (host) {
      await host.close();
    }
  });

  it("serves status, health, rpc, and openapi", async () => {
    const statusRes = await fetch(`${baseUrl}/`);
    expect(statusRes.ok).toBe(true);
    const status = (await statusRes.json()) as { ok: boolean; module: string; status: string };
    expect(status).toMatchObject({ ok: true, module: "host", status: "ready" });

    const healthRes = await fetch(`${baseUrl}/health`);
    expect(healthRes.ok).toBe(true);
    expect(await healthRes.text()).toBe("OK");

    const apiRes = await fetch(`${baseUrl}/api/ping`);
    expect(apiRes.ok).toBe(true);
    expect(await apiRes.json()).toEqual({ ok: true, name: "direct-host" });

    const specRes = await fetch(`${baseUrl}/api/spec.json`);
    expect(specRes.ok).toBe(true);
    const spec = (await specRes.json()) as { openapi?: string };
    expect(spec.openapi).toBe("3.1.1");

    const rpcRes = await fetch(`${baseUrl}/api/rpc/ping`, { method: "POST" });
    expect(rpcRes.ok).toBe(true);
    expect(await rpcRes.json()).toEqual({ json: { ok: true, name: "direct-host" } });
  });
});
