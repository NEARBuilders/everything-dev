import { describe, expect, it } from "vitest";
import {
  DEFAULT_THING_PAYLOAD,
  formatThingPayload,
  isSignInError,
  parseThingPayload,
} from "./-thing-form";

describe("thing form", () => {
  it("parses the default payload", () => {
    expect(parseThingPayload(DEFAULT_THING_PAYLOAD)).toEqual({
      ok: true,
      value: { kind: "demo", value: "hello" },
    });
  });

  it("reports blank and malformed payloads", () => {
    expect(parseThingPayload("  ")).toEqual({ ok: false, error: "Payload is required" });
    const result = parseThingPayload("{ nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^Invalid JSON/);
  });

  it("formats valid JSON and leaves invalid input untouched", () => {
    expect(formatThingPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatThingPayload("{ nope")).toBe("{ nope");
  });

  it("only treats unauthorized errors as sign-in problems", () => {
    expect(isSignInError({ code: "UNAUTHORIZED" })).toBe(true);
    expect(isSignInError({ status: 401 })).toBe(true);
    expect(isSignInError({ code: "BAD_REQUEST", status: 400 })).toBe(false);
    expect(isSignInError(new Error("Proposal already exists"))).toBe(false);
    expect(isSignInError(null)).toBe(false);
  });
});
