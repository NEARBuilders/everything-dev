import { describe, expect, it } from "vitest";
import { getGatewayOrigin } from "./gateway-origin";

const runtimeConfig = { runtime: { gatewayId: "citynode.app" } } as Parameters<
  typeof getGatewayOrigin
>[0];

describe("getGatewayOrigin", () => {
  it("points a member on a tenant domain at the gateway, not the tenant", () => {
    expect(getGatewayOrigin(runtimeConfig, new URL("https://chicago.citynode.app/onboard"))).toBe(
      "https://citynode.app",
    );
    expect(getGatewayOrigin(runtimeConfig, new URL("https://nearchicago.org/onboard"))).toBe(
      "https://citynode.app",
    );
  });

  it("points a local tenant subdomain at the local gateway", () => {
    expect(getGatewayOrigin(runtimeConfig, new URL("http://chicago.localhost:3000/onboard"))).toBe(
      "http://localhost:3000",
    );
  });

  it("falls back to the current origin when no gateway is configured", () => {
    expect(getGatewayOrigin({}, new URL("https://example.org/onboard"))).toBe(
      "https://example.org",
    );
  });
});
