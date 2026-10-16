import { describe, expect, it } from "vitest";
import { parseSiteErrorDetail } from "../../src/services/auth/site-client";

describe("parseSiteErrorDetail", () => {
  it("reads better-auth's { message } shape", () => {
    expect(parseSiteErrorDetail(400, { message: "Invalid token" })).toBe("Invalid token");
  });

  it("reads better-auth's { error: { message } } shape", () => {
    expect(parseSiteErrorDetail(400, { error: { message: "Bad request" } })).toBe("Bad request");
  });

  it("reads the oRPC envelope { json: { code, message, data } } — the bare-403 case", () => {
    const detail = parseSiteErrorDetail(403, {
      json: {
        defined: true,
        code: "FORBIDDEN",
        message:
          "Deploy keys can only be minted for NEAR accounts linked to your login — link acct.near first",
        data: { action: "deploy-key acct.near/app.test" },
      },
      meta: [],
    });
    expect(detail).toBe(
      "Deploy keys can only be minted for NEAR accounts linked to your login — link acct.near first",
    );
  });

  it("reads a flat oRPC error { defined, code, message }", () => {
    expect(parseSiteErrorDetail(403, { defined: true, code: "FORBIDDEN", message: "nope" })).toBe(
      "nope",
    );
  });

  it("reads { error: { message, data } } with the data detail", () => {
    expect(
      parseSiteErrorDetail(403, {
        error: { message: "Denied", data: { action: "deploy-key" } },
      }),
    ).toBe("Denied");
  });

  it("returns undefined when no shape matches", () => {
    expect(parseSiteErrorDetail(403, {})).toBeUndefined();
    expect(parseSiteErrorDetail(403, undefined)).toBeUndefined();
  });
});
