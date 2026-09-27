import { describe, expect, it } from "vitest";
import { getGatewayOrigin, onboardingUrl } from "./gateway-origin";

describe("getGatewayOrigin", () => {
  it("points an organizer on a tenant domain at the gateway", () => {
    expect(getGatewayOrigin("citynode.app", new URL("https://nearchicago.org/onboarding"))).toBe(
      "https://citynode.app",
    );
  });

  it("points a local tenant subdomain at the local gateway", () => {
    expect(
      getGatewayOrigin("citynode.app", new URL("http://chicago.localhost:3000/onboarding")),
    ).toBe("http://localhost:3000");
  });

  it("falls back to the current origin when no gateway is configured", () => {
    expect(getGatewayOrigin(undefined, new URL("https://example.org/onboarding"))).toBe(
      "https://example.org",
    );
  });
});

describe("onboardingUrl", () => {
  it("builds the onboard link for a code on the gateway", () => {
    expect(onboardingUrl("https://citynode.app", "abc_DEF-123")).toBe(
      "https://citynode.app/onboard?code=abc_DEF-123",
    );
  });
});
