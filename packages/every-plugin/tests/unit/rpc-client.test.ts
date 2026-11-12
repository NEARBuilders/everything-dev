import { oc } from "@orpc/contract";
import { createRpcClient } from "every-plugin/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const contract = oc.router({
  echo: oc.input(z.object({ value: z.string() })).output(z.object({ value: z.string() })),
});

function stubFetch() {
  const fetch = vi.fn(
    async (_input: Request | string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ json: { value: "ok" } }), {
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function sentRequest(fetch: ReturnType<typeof stubFetch>) {
  const [input, init] = fetch.mock.calls[0] ?? [""];
  return input instanceof Request ? input : new Request(input, init);
}

describe("createRpcClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins the default /api/rpc path onto the host url", async () => {
    const fetch = stubFetch();
    const client = createRpcClient<typeof contract>("https://api.example.test");

    await expect(client.echo({ value: "hi" })).resolves.toEqual({ value: "ok" });

    const request = await sentRequest(fetch);
    expect(request.url).toBe("https://api.example.test/api/rpc/echo");
    expect(request.headers.get("content-type")).toContain("application/json");
    expect(await request.json()).toEqual({ json: { value: "hi" } });
  });

  it("joins a custom path for namespaced plugin surfaces", async () => {
    const fetch = stubFetch();
    const client = createRpcClient<typeof contract>(
      "https://api.example.test",
      "/api/rpc/feedback",
    );

    await client.echo({ value: "hi" });

    const request = await sentRequest(fetch);
    expect(request.url).toBe("https://api.example.test/api/rpc/feedback/echo");
  });
});
