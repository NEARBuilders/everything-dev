import { describe, expect, it } from "vitest";
import { compareSemver, satisfiesConstraint } from "../../src/utils/semver";

describe("compareSemver", () => {
  it.each([
    ["2.0.0-rc.9", "2.0.0-rc.10", -1],
    ["2.0.0-rc.10", "2.0.0-rc.11", -1],
    ["2.0.0-rc.11", "2.0.0", -1],
    ["1.60.0-rc.1", "1.60.0-rc.7", -1],
    ["1.60.0-rc.7", "1.60.0-rc.1", 1],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-rc.1", "1.0.0-rc.1.1", -1],
    ["1.0.0-rc.1.1", "1.0.0-rc.1", 1],
    ["1.0.0-rc.1", "1.0.0-rc.1.beta", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.2.3", "1.2.3", 0],
    ["1.2.3", "1.2.4", -1],
    ["1.10.0", "1.9.0", 1],
    ["2.0.0", "1.0.0", 1],
  ])("%s vs %s → %i", (a, b, expected) => {
    expect(compareSemver(a, b)).toBe(expected);
  });

  it("compares unparseable versions as equal — never gate on versions it cannot order", () => {
    expect(compareSemver("abc", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", "abc")).toBe(0);
    expect(compareSemver(undefined, "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0", undefined)).toBe(0);
    expect(compareSemver(undefined, undefined)).toBe(0);
    expect(compareSemver("abc", "def")).toBe(0);
  });

  it("strips range prefixes and v markers before comparing", () => {
    expect(compareSemver("^1.2.3", "1.2.4")).toBe(-1);
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });
});

describe("satisfiesConstraint", () => {
  it.each([
    ["1.2.3", "=1.2.3", true],
    ["1.2.4", "=1.2.3", false],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.5.0", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["1.2.0", "^1.2.3", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.0.0-rc.7", "^1.0.0-rc.1", true],
    ["1.0.0-rc.0", "^1.0.0-rc.1", false],
    ["1.0.0-rc.1.1", "^1.0.0-rc.1", true],
    ["1.0.1", "^1.0.0-rc.1", false],
    ["1.0.0-rc.1", ">1.0.0-rc.0", true],
    ["1.0.0-rc.1", ">1.0.0-rc.1", false],
    ["1.0.0-rc.1", "<1.0.0-rc.2", true],
    ["4.0.0-rc.112", "4.0.0-rc.112", true],
    ["4.0.0-rc.112", "^4.0.0-rc.112", true],
    ["4.0.0-rc.110", "^4.0.0-rc.112", false],
  ])("%s vs %s → %s", (version, constraint, expected) => {
    expect(satisfiesConstraint(version, constraint)).toBe(expected);
  });

  it("treats an empty constraint as satisfied", () => {
    expect(satisfiesConstraint("1.2.3", "")).toBe(true);
    expect(satisfiesConstraint("1.2.3", "   ")).toBe(true);
  });

  it("a version with a prerelease does not satisfy a constraint without one", () => {
    expect(satisfiesConstraint("1.0.0-rc.1", "^1.0.0")).toBe(false);
    expect(satisfiesConstraint("1.0.0-rc.1", "1.0.0")).toBe(false);
  });
});
