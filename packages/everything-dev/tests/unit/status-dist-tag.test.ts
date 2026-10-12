import { describe, expect, it } from "vitest";
import { pickDistTagVersion, resolveUpdateDistTag } from "../../src/cli/status";

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
