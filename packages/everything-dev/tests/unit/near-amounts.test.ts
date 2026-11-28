import { describe, expect, it } from "vitest";
import { parseYocto } from "../../src/services/auth/near-amounts";

describe("parseYocto", () => {
  it.each([
    ["0", 0n],
    ["1", 1n],
    ["300000000000000000000000", 300000000000000000000000n],
    ["  42  ", 42n],
    ["000123", 123n],
  ])("reads the integer text %j exactly", (text, expected) => {
    expect(parseYocto(text)).toBe(expected);
  });

  it("keeps a 78-digit balance exact", () => {
    expect(parseYocto("340282366920938463463374607431768211456")).toBe(
      340282366920938463463374607431768211456n,
    );
  });

  it.each([
    ["1.28"],
    ["1.0"],
    ["1e24"],
    ["1.28e24"],
    ["-1"],
    ["+1"],
    [""],
    ["   "],
    ["1 NEAR"],
    ["0x10"],
    ["NaN"],
    ["1_000"],
  ])("an unreadable amount (%j) is undefined — never zero", (text) => {
    expect(parseYocto(text)).toBeUndefined();
  });
});
