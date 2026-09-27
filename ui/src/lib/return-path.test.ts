import { describe, expect, it } from "vitest";
import { returnPath } from "./return-path";

describe("returnPath", () => {
  it("keeps an in-app path with its search", () => {
    expect(returnPath("/things/abc?tab=details")).toBe("/things/abc?tab=details");
  });

  it("rejects off-site and protocol-relative targets", () => {
    expect(returnPath("https://evil.example/")).toBeUndefined();
    expect(returnPath("//evil.example/")).toBeUndefined();
    expect(returnPath("/\\evil.example/")).toBeUndefined();
    expect(returnPath("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects missing, empty and non-string values", () => {
    expect(returnPath(undefined)).toBeUndefined();
    expect(returnPath("")).toBeUndefined();
    expect(returnPath(42)).toBeUndefined();
  });
});
