import type { RuntimePluginConfig } from "everything-dev/types";
import { describe, expect, it } from "vitest";
import { createRpcPluginClient } from "../../src/services/rpc-plugin";

function callOnlyEntry(extra: Partial<RuntimePluginConfig> = {}): RuntimePluginConfig {
  return {
    name: "feedback-plugin",
    url: "https://feedback.example.com/",
    entry: "",
    source: "remote",
    proxy: "https://feedback.example.com",
    contractUrl:
      "https://cdn.everything.dev/bundles/nearbuilding.near/feedback.nearbuilders.org/api",
    ...extra,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("createRpcPluginClient (#848 call-only attachments)", () => {
  it("sends typed rpc calls to the proxy endpoint with the declared secret as x-api-key", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const rpc = createRpcPluginClient(
      "feedback",
      callOnlyEntry({ secrets: ["FEEDBACK_API_KEY"] }),
      {
        fetch: async (input, init) => {
          calls.push({
            url: String(input),
            headers: new Headers(init?.headers),
          });
          return jsonResponse({ json: { slug: "my-project" } });
        },
        resolveSecret: (name) => (name === "FEEDBACK_API_KEY" ? "api_secret_123" : undefined),
      },
    );

    const client = rpc.createClient() as {
      getProjectBySlug: (input: { slug: string }) => Promise<unknown>;
    };
    const result = await client.getProjectBySlug({ slug: "my-project" });

    expect(result).toEqual({ slug: "my-project" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://feedback.example.com/api/rpc/getProjectBySlug");
    expect(calls[0]?.headers.get("x-api-key")).toBe("api_secret_123");
  });

  it("goes out without x-api-key when the declared secret is unset", async () => {
    let sawHeader: string | null = null;
    const rpc = createRpcPluginClient(
      "feedback",
      callOnlyEntry({ secrets: ["FEEDBACK_API_KEY"] }),
      {
        fetch: async (_input, init) => {
          sawHeader = new Headers(init?.headers).get("x-api-key");
          return jsonResponse({});
        },
        resolveSecret: () => undefined,
      },
    );
    await (rpc.createClient() as { ping: () => Promise<unknown> }).ping();
    expect(sawHeader).toBeNull();
  });

  it("carries the proxy fact and probe url the routes and dev planes consume", () => {
    const rpc = createRpcPluginClient(
      "feedback",
      callOnlyEntry({ secrets: ["FEEDBACK_API_KEY"] }),
      {
        fetch: async () => jsonResponse({}),
        resolveSecret: () => "api_secret_123",
      },
    );
    expect(rpc.proxy).toEqual({ target: "https://feedback.example.com", apiKey: "api_secret_123" });
    expect(rpc.probeUrl).toBe("https://feedback.example.com/api/rpc/ping");
    expect(rpc.router).toBeUndefined();
    expect(rpc.metadata).toEqual({ remoteUrl: "https://feedback.example.com" });
  });
});
