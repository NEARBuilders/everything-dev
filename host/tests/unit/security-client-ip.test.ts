import { describe, expect, it } from "vitest";
import { clientIpOf, clientKeyOf, resolveTrustedIpHeader } from "../../src/middleware/security";

describe("clientIpOf", () => {
  it("keys on the configured trusted header when the request carries it", () => {
    expect(clientIpOf({ "cf-connecting-ip": "203.0.113.9" }, "10.0.0.1", "cf-connecting-ip")).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to the socket address when the configured header is absent or empty", () => {
    expect(clientIpOf({}, "10.0.0.1", "cf-connecting-ip")).toBe("10.0.0.1");
    expect(clientIpOf({ "cf-connecting-ip": "   " }, "10.0.0.1", "cf-connecting-ip")).toBe(
      "10.0.0.1",
    );
  });

  it("ignores a client-sent x-forwarded-for when no trusted header is configured", () => {
    expect(clientIpOf({ "x-forwarded-for": "1.2.3.4" }, "127.0.0.1", "")).toBe("127.0.0.1");
  });

  it("ignores x-forwarded-for even when a different trusted header is configured", () => {
    expect(clientIpOf({ "x-forwarded-for": "1.2.3.4" }, "127.0.0.1", "cf-connecting-ip")).toBe(
      "127.0.0.1",
    );
  });

  it("trims the trusted header value", () => {
    expect(
      clientIpOf({ "cf-connecting-ip": " 203.0.113.9 " }, "10.0.0.1", "cf-connecting-ip"),
    ).toBe("203.0.113.9");
  });

  it("matches the trusted header name case-insensitively", () => {
    expect(clientIpOf({ "cf-connecting-ip": "203.0.113.9" }, "10.0.0.1", "CF-Connecting-IP")).toBe(
      "203.0.113.9",
    );
  });
});

describe("resolveTrustedIpHeader", () => {
  const authored = { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } };

  it("derives the default from the authored ipAddress config when no env var is set", () => {
    expect(resolveTrustedIpHeader(undefined, authored)).toBe("cf-connecting-ip");
  });

  it("prefers the BOS_CLIENT_IP_HEADER env override over the authored config", () => {
    expect(resolveTrustedIpHeader("x-real-ip", authored)).toBe("x-real-ip");
  });

  it("falls back to the socket identity when neither source is present", () => {
    expect(resolveTrustedIpHeader(undefined, undefined)).toBe("");
    expect(resolveTrustedIpHeader(undefined, {})).toBe("");
    expect(resolveTrustedIpHeader(undefined, { ipAddress: {} })).toBe("");
    expect(resolveTrustedIpHeader(undefined, { ipAddress: { ipAddressHeaders: [] } })).toBe("");
  });

  it("trims both sources and ignores whitespace-only values", () => {
    expect(resolveTrustedIpHeader("   ", authored)).toBe("cf-connecting-ip");
    expect(
      resolveTrustedIpHeader(undefined, { ipAddress: { ipAddressHeaders: ["  x-real-ip "] } }),
    ).toBe("x-real-ip");
  });

  it("ignores malformed authored values instead of trusting them", () => {
    expect(resolveTrustedIpHeader(undefined, null)).toBe("");
    expect(resolveTrustedIpHeader(undefined, { ipAddress: { ipAddressHeaders: [42] } })).toBe("");
    expect(
      resolveTrustedIpHeader(undefined, { ipAddress: { ipAddressHeaders: "cf-connecting-ip" } }),
    ).toBe("");
  });
});

describe("clientKeyOf", () => {
  const ctxWithHeaders = (headers: Record<string, string | undefined>) =>
    ({
      req: { header: (name?: string) => (name ? headers[name.toLowerCase()] : headers) },
    }) as never;

  it("never reads x-forwarded-for: a bare context resolves to the socket fallback (unknown)", () => {
    expect(clientKeyOf(ctxWithHeaders({ "x-forwarded-for": "1.2.3.4" }), "")).toBe("unknown");
  });

  it("keys on the factory-derived default: the authored header splits buckets without any env var", () => {
    const trusted = resolveTrustedIpHeader(undefined, {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    });
    expect(clientKeyOf(ctxWithHeaders({ "cf-connecting-ip": "203.0.113.9" }), trusted)).toBe(
      "203.0.113.9",
    );
  });

  it("the env override still wins over the authored default", () => {
    const trusted = resolveTrustedIpHeader("x-real-ip", {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    });
    expect(clientKeyOf(ctxWithHeaders({ "x-real-ip": "198.51.100.7" }), trusted)).toBe(
      "198.51.100.7",
    );
    expect(clientKeyOf(ctxWithHeaders({ "cf-connecting-ip": "203.0.113.9" }), trusted)).toBe(
      "unknown",
    );
  });

  it("neither source present: the identity is the socket fallback even when a client sends the authored header name", () => {
    const trusted = resolveTrustedIpHeader(undefined, undefined);
    expect(clientKeyOf(ctxWithHeaders({ "cf-connecting-ip": "203.0.113.9" }), trusted)).toBe(
      "unknown",
    );
  });
});
