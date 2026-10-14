import { describe, expect, it } from "vitest";
import { isMcpRequestAuthorized } from "../../src/services/mcp";

describe("isMcpRequestAuthorized", () => {
  it("rejects unauthenticated contexts (no session, no API key)", () => {
    expect(isMcpRequestAuthorized({ isAuthenticated: false, authMethod: "none" })).toBe(false);
    expect(isMcpRequestAuthorized({ isAuthenticated: false, authMethod: "anonymous" })).toBe(false);
    expect(isMcpRequestAuthorized({})).toBe(false);
  });

  it("authorizes session and API-key callers", () => {
    expect(isMcpRequestAuthorized({ isAuthenticated: true, authMethod: "session" })).toBe(true);
    expect(isMcpRequestAuthorized({ isAuthenticated: true, authMethod: "apiKey" })).toBe(true);
  });
});
