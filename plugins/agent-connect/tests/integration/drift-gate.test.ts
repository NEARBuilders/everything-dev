import { DEFAULT_BASE_URL } from "@near-intents-agent-api/sdk";
import { describe, expect, it } from "vitest";

/**
 * Drift gate — opt-in live check that the hosted Agent API still exposes the
 * endpoints this plugin proxies. The SDK is generated from the API's
 * OpenAPI spec, so drift between the SDK and the API is upstream's to fix;
 * this test catches the case where the *deployment* the plugin points at
 * (`AGENT_CONNECT_LIVE_BASE_URL`, default: the SDK's default) no longer
 * matches the surface the plugin assumes. Run with:
 *
 *   AGENT_CONNECT_LIVE_CHECK=1 pnpm test
 */
describe.skipIf(!process.env.AGENT_CONNECT_LIVE_CHECK)("live drift gate", () => {
  const baseUrl = process.env.AGENT_CONNECT_LIVE_BASE_URL ?? DEFAULT_BASE_URL;

  it("exposes the paths the plugin proxies", async () => {
    const response = await fetch(new URL("/openapi.json", baseUrl), {
      headers: { accept: "application/json" },
    });
    expect(response.ok).toBe(true);

    const spec = (await response.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});

    for (const expected of [
      "/v1/agents",
      "/v1/agents/{agent_id}",
      "/v1/generate-intent",
      "/v1/submit-intent",
      "/v1/status",
      "/v1/agents/{agent_id}/grants",
    ]) {
      expect(paths, `missing ${expected}`).toContain(expected);
    }
  });
});
