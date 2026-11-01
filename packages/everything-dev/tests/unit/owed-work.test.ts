import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeImageTags, conditionImageTags } from "../../src/services/deploy/image";
import { detectOwedWork, owedWorkDrift } from "../../src/services/deploy/owed";

let tempDir: string;

const writeFrameworkVersion = (version: string) => {
  mkdirSync(join(tempDir, "packages", "everything-dev"), { recursive: true });
  writeFileSync(
    join(tempDir, "packages", "everything-dev", "package.json"),
    JSON.stringify({ name: "everything-dev", version }),
  );
};

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("detectOwedWork (#571)", () => {
  it("npmOwed — a publishable version npm does not serve yet", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "owed-"));
    writeFrameworkVersion("2.0.0-rc.22");
    const owed = await detectOwedWork(
      { configDir: tempDir, account: "a", gateway: "g" },
      {
        npmPublished: async () => [{ name: "everything-dev", version: "2.0.0-rc.22" }],
        fetchPointer: async () => ({ frameworkVersion: "2.0.0-rc.22" }),
      },
    );
    expect(owed.npmOwed).toBe(true);
    expect(owed.manifestOwed).toBe(false);
    expect(owed.release).toBe(true);
  });

  it("manifestOwed — the pointer trails the repo's framework version", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "owed-"));
    writeFrameworkVersion("2.0.0-rc.22");
    const owed = await detectOwedWork(
      { configDir: tempDir, account: "a", gateway: "g" },
      {
        npmPublished: async () => [],
        fetchPointer: async () => ({ frameworkVersion: "2.0.0-rc.21" }),
      },
    );
    expect(owed.npmOwed).toBe(false);
    expect(owed.manifestOwed).toBe(true);
    expect(owed.release).toBe(true);
  });

  it("no pointer at all — a manifest is owed (first release cycle)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "owed-"));
    writeFrameworkVersion("2.0.0-rc.22");
    const owed = await detectOwedWork(
      { configDir: tempDir, account: "a", gateway: "g" },
      {
        npmPublished: async () => [],
        fetchPointer: async () => null,
      },
    );
    expect(owed.manifestOwed).toBe(true);
    expect(owed.detail.pointerExists).toBe(false);
  });

  it("unknown states never block: npm unreachable and pointer read failure read as not owed", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "owed-"));
    writeFrameworkVersion("2.0.0-rc.22");
    const owed = await detectOwedWork(
      { configDir: tempDir, account: "a", gateway: "g" },
      {
        npmPublished: async () => {
          throw new Error("registry unreachable");
        },
        fetchPointer: async () => {
          throw new Error("fastkv unreachable");
        },
      },
    );
    expect(owed.npmOwed).toBe(false);
    expect(owed.manifestOwed).toBe(false);
    expect(owed.release).toBe(false);
  });

  it("a child workspace (no packages/) owes nothing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "owed-"));
    const owed = await detectOwedWork(
      { configDir: tempDir },
      { npmPublished: async () => [], fetchPointer: async () => null },
    );
    expect(owed.release).toBe(false);
  });

  it("derives from live state — the superseded-release scenario publishes on the next train", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "owed-"));
    writeFrameworkVersion("2.0.0-rc.23");
    const detect = (pointerVersion: string) =>
      detectOwedWork(
        { configDir: tempDir, account: "a", gateway: "g" },
        {
          npmPublished: async () => [],
          fetchPointer: async () => ({ frameworkVersion: pointerVersion }),
        },
      );
    // a bump to rc.22 overtaken by the rc.23 merge before its train ran: by
    // the time the next tip's train looks, the only facts are live — the
    // pointer trails the repo (owed, and it is rc.23 that publishes), or it
    // already moved (not owed). No git-history state can stall either way.
    const owed = await detect("2.0.0-rc.22");
    expect(owed.manifestOwed).toBe(true);
    expect(owed.detail.localFrameworkVersion).toBe("2.0.0-rc.23");
    expect((await detect("2.0.0-rc.23")).manifestOwed).toBe(false);
    // a pointer ahead of the repo (a checkout behind production) is not owed
    expect((await detect("2.0.0-rc.24")).manifestOwed).toBe(false);
  });
});

describe("owedWorkDrift — the in-train cross-check", () => {
  const base = {
    detail: {
      unpublished: [] as Array<{ name: string; version: string }>,
      pointerExists: true,
    },
  };

  it("flags npmOwed without manifestOwed after a completed release cycle", () => {
    const drift = owedWorkDrift({
      ...base,
      npmOwed: true,
      manifestOwed: false,
      release: true,
      detail: {
        ...base.detail,
        unpublished: [{ name: "everything-dev", version: "2.0.0-rc.22" }],
        localFrameworkVersion: "2.0.0-rc.22",
        pointerFrameworkVersion: "2.0.0-rc.22",
      },
    });
    expect(drift).toMatch(/drift/);
    expect(drift).toMatch(/everything-dev@2.0.0-rc.22/);
  });

  it("flags manifestOwed without npmOwed — the #568 window", () => {
    const drift = owedWorkDrift({
      ...base,
      npmOwed: false,
      manifestOwed: true,
      release: true,
      detail: {
        ...base.detail,
        localFrameworkVersion: "2.0.0-rc.22",
        pointerFrameworkVersion: "2.0.0-rc.21",
      },
    });
    expect(drift).toMatch(/drift/);
    expect(drift).toMatch(/2.0.0-rc.21/);
  });

  it("consistent states and missing pointers never drift", () => {
    expect(
      owedWorkDrift({
        ...base,
        npmOwed: false,
        manifestOwed: false,
        release: false,
        detail: base.detail,
      }),
    ).toBeUndefined();
    expect(
      owedWorkDrift({
        ...base,
        detail: { ...base.detail, pointerExists: false },
        npmOwed: true,
        manifestOwed: false,
        release: true,
      }),
    ).toBeUndefined();
  });
});

describe("conditionImageTags — release-conditional tag movement", () => {
  it("release leg moves the computed tags verbatim", () => {
    const computed = computeImageTags({ shortSha: "abc1234", version: "2.0.0" });
    const conditioned = conditionImageTags(computed, true);
    expect(conditioned.tags).toEqual(computed.tags);
    expect(conditioned.pushLatest).toBe(computed.pushLatest);
  });

  it("non-release deploys push the sha tag only", () => {
    const rc = computeImageTags({ shortSha: "abc1234", version: "2.0.0-rc.21" });
    expect(conditionImageTags(rc, false)).toEqual({
      tags: ["sha-abc1234"],
      pushLatest: false,
      pushRc: false,
    });

    const stable = computeImageTags({ shortSha: "abc1234", version: "2.0.0" });
    expect(conditionImageTags(stable, false)).toEqual({
      tags: ["sha-abc1234"],
      pushLatest: false,
      pushRc: false,
    });

    const noVersion = computeImageTags({ shortSha: "abc1234" });
    expect(conditionImageTags(noVersion, false).tags).toEqual(["sha-abc1234"]);
  });
});
