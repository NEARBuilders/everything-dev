import { expect, test } from "@playwright/test";
import { collectErrors, expectNoHydrationFailure, waitForApp } from "../helpers/page-ready";
import { injectCookies } from "../helpers/seeded";

// The x-api-key surface authenticates every agent entry point (REST, oRPC,
// plugin RPC, MCP) but had zero end-to-end coverage: the Go suite exercises
// anonymous sessions only and this spec's page-loads never created a key.
// One test drives the whole arc on the real Settings page — create via UI
// (the full secret is shown once in the reveal dialog), then authenticate
// with it programmatically.

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

// Streamable-HTTP MCP may answer with an SSE body; unwrap the last data line,
// falling back to a plain JSON body.
function unwrapMcp(text: string): any {
  const dataLines = text.split("\n").filter((line) => line.startsWith("data:"));
  const payload = dataLines.length > 0 ? dataLines[dataLines.length - 1]!.slice(5).trim() : text;
  return JSON.parse(payload);
}

test("created API key authenticates REST, plugin RPC, and MCP", async ({ page, request }) => {
  const errors = collectErrors(page);
  await injectCookies(page);
  await page.goto("/settings/api-keys", { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  await page.getByTestId("api-keys.create-button").click();
  await page.getByTestId("api-keys.name-input").fill("regression-e2e");
  await page.getByTestId("api-keys.create-submit").click();

  const secret = page.getByTestId("api-keys.secret");
  await expect(secret).toBeVisible({ timeout: 10000 });
  const apiKey = ((await secret.textContent()) ?? "").trim();
  expect(apiKey).toMatch(/^api_/);
  await page.getByTestId("api-keys.reveal-done").click();

  expectNoHydrationFailure(errors);

  const garbage = await request.get("/api/ping", { headers: { "x-api-key": "api_garbage" } });
  expect(garbage.status()).toBe(401);

  const ping = await request.get("/api/ping", { headers: { "x-api-key": apiKey } });
  expect(ping.status()).toBe(200);

  const thingId = `regression-api-key-${Date.now()}`;
  const created = await request.post("/api/rpc/template/createThing", {
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    data: { thingId, payload: { source: "api-key-auth.spec" } },
  });
  expect(created.status()).toBe(200);
  const createdBody = await created.json();
  expect(createdBody.thingId).toBe(thingId);

  const readBack = await request.post("/api/rpc/template/getThing", {
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    data: { thingId },
  });
  expect(readBack.status()).toBe(200);
  const readBackBody = await readBack.json();
  expect(readBackBody.thingId).toBe(thingId);

  const initialize = await request.post("/api/mcp", {
    headers: { ...mcpHeaders, "x-api-key": apiKey },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "regression-browser", version: "0.0.0" },
      },
    },
  });
  expect(initialize.status()).toBe(200);
  const sessionId = initialize.headers()["mcp-session-id"];
  const initialized = unwrapMcp(await initialize.text());
  expect(String(initialized.result?.serverInfo?.name ?? "")).toContain("MCP");

  const tools = await request.post("/api/mcp", {
    headers: {
      ...mcpHeaders,
      "x-api-key": apiKey,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  expect(tools.status()).toBe(200);
  const toolsBody = unwrapMcp(await tools.text());
  const toolNames = (toolsBody.result?.tools ?? []).map((tool: { name: string }) => tool.name);
  expect(toolNames).toContain("ping");
});
