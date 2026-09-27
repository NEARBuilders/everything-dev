import { describe, expect, it } from "vitest";
import { parseNearAmount } from "./near-amount";

describe("parseNearAmount", () => {
  it("preserves every yocto digit without going through Number", () => {
    expect(parseNearAmount("1.234567890123456789012345")).toBe(1234567890123456789012345n);
    expect(parseNearAmount("0.000000000000000000000001")).toBe(1n);
  });

  it.each([
    "",
    "0",
    "0.0000",
    "-1",
    "1e3",
    "Infinity",
    "1.1234567890123456789012345",
  ])("rejects %s", (value) => {
    expect(parseNearAmount(value)).toBeNull();
  });

  it("trims surrounding whitespace and accepts whole NEAR values", () => {
    expect(parseNearAmount("  5  ")).toBe(5_000_000_000_000_000_000_000_000n);
  });
});
