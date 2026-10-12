import { describe, expect, it } from "vitest";
import { compareSemver, pickDistTagVersion, resolveUpdateDistTag } from "../../src/cli/status";

describe("resolveUpdateDistTag", () => {
  it("tracks the rc dist-tag for prerelease installs", () => {
    expect(resolveUpdateDistTag("2.0.0-rc.0")).toBe("rc");
    expect(resolveUpdateDistTag("2.0.0-rc.1")).toBe("rc");
    expect(resolveUpdateDistTag("1.0.0-beta.2")).toBe("rc");
  });

  it("tracks latest for stable and unknown installs", () => {
    expect(resolveUpdateDistTag("2.0.0")).toBe("latest");
    expect(resolveUpdateDistTag("1.53.2")).toBe("latest");
    expect(resolveUpdateDistTag(undefined)).toBe("latest");
  });
});

describe("pickDistTagVersion", () => {
  it("reads the requested dist-tag", () => {
    expect(pickDistTagVersion({ latest: "1.53.2", rc: "2.0.0-rc.1" }, "rc")).toBe("2.0.0-rc.1");
    expect(pickDistTagVersion({ latest: "1.53.2", rc: "2.0.0-rc.1" }, "latest")).toBe("1.53.2");
  });

  it("returns null when the dist-tag is absent (fall back to no banner)", () => {
    expect(pickDistTagVersion({ latest: "1.53.2" }, "rc")).toBeNull();
    expect(pickDistTagVersion(undefined, "rc")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("orders prerelease increments", () => {
    expect(compareSemver("2.0.0-rc.1", "2.0.0-rc.2")).toBeLessThan(0);
    expect(compareSemver("2.0.0-rc.2", "2.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareSemver("2.0.0-rc.2", "2.0.0-rc.2")).toBe(0);
  });

  it("orders an install ahead of npm as newer (no downgrade warning)", () => {
    expect(compareSemver("2.0.0-rc.2", "2.0.0-rc.1")).toBe(1);
    expect(compareSemver("3.0.0-rc.1", "3.0.0-rc.0")).toBe(1);
  });

  it("ranks releases above their prereleases", () => {
    expect(compareSemver("2.0.0", "2.0.0-rc.9")).toBeGreaterThan(0);
    expect(compareSemver("2.0.0-rc.1", "2.0.0")).toBeLessThan(0);
  });

  it("orders core versions numerically", () => {
    expect(compareSemver("1.53.2", "2.0.0-rc.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0-rc.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("2.10.1", "2.9.9")).toBeGreaterThan(0);
  });

  it("follows semver prerelease identifier precedence", () => {
    expect(compareSemver("2.0.0-rc.1", "2.0.0-rc.1.1")).toBeLessThan(0);
    expect(compareSemver("2.0.0-1", "2.0.0-rc")).toBeLessThan(0);
    expect(compareSemver("2.0.0-alpha.1", "2.0.0-beta.1")).toBeLessThan(0);
  });

  it("compares equal on unparseable input so the update check stays silent", () => {
    expect(compareSemver(undefined, "2.0.0-rc.1")).toBe(0);
    expect(compareSemver("2.0.0-rc.2", undefined)).toBe(0);
    expect(compareSemver("not-a-version", "2.0.0-rc.1")).toBe(0);
    expect(compareSemver("git-linked", "")).toBe(0);
  });

  it("tolerates range prefixes", () => {
    expect(compareSemver("^2.0.0-rc.2", "2.0.0-rc.1")).toBe(1);
    expect(compareSemver("v2.0.0-rc.2", "2.0.0-rc.1")).toBe(1);
    expect(compareSemver("~1.0.0", "1.0.0")).toBe(0);
  });
});
