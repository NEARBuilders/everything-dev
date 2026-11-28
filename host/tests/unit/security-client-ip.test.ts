import { describe, expect, it } from "vitest";
import { clientIpOf, clientKeyOf } from "../../src/middleware/security";

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

describe("clientKeyOf", () => {
  const ctxWithHeaders = (headers: Record<string, string | undefined>) =>
    ({
      req: { header: (name?: string) => (name ? headers[name.toLowerCase()] : headers) },
    }) as never;

  it("never reads x-forwarded-for: a bare context resolves to the socket fallback (unknown)", () => {
    expect(clientKeyOf(ctxWithHeaders({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
  });
});
