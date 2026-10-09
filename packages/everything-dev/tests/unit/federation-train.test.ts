import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkFederationTrain,
  everyPluginStamp,
  resolveAuthWorkspace,
} from "../../src/federation-train";

describe("resolveAuthWorkspace", () => {
  it("resolves a local auth app-slot to its workspace directory", () => {
    expect(resolveAuthWorkspace({ app: { auth: { development: "local:plugins/auth" } } })).toBe(
      "plugins/auth",
    );
  });

  it("returns null when auth is absent", () => {
    expect(resolveAuthWorkspace(undefined)).toBeNull();
    expect(resolveAuthWorkspace(null)).toBeNull();
    expect(resolveAuthWorkspace({})).toBeNull();
    expect(resolveAuthWorkspace({ app: {} })).toBeNull();
    expect(resolveAuthWorkspace({ app: { auth: {} } })).toBeNull();
  });

  it("returns null for malformed or non-local development values", () => {
    expect(resolveAuthWorkspace({ app: { auth: { development: 42 } } })).toBeNull();
    expect(
      resolveAuthWorkspace({ app: { auth: { development: "https://auth.example.com" } } }),
    ).toBeNull();
  });
});

describe("everyPluginStamp", () => {
  it("reads the version from the every-plugin shared entry", () => {
    expect(
      everyPluginStamp({
        shared: [
          { name: "zod", version: "4.6.5" },
          { name: "every-plugin", version: "2.10.1" },
        ],
      }),
    ).toBe("2.10.1");
  });

  it("falls back to requiredVersion when version is absent", () => {
    expect(
      everyPluginStamp({ shared: [{ name: "every-plugin", requiredVersion: "3.0.0-rc.0" }] }),
    ).toBe("3.0.0-rc.0");
  });

  it("returns null when every-plugin is not shared", () => {
    expect(everyPluginStamp({ shared: [{ name: "zod", version: "4.6.5" }] })).toBeNull();
    expect(everyPluginStamp({})).toBeNull();
    expect(everyPluginStamp({ shared: [] })).toBeNull();
  });
});

describe("checkFederationTrain", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  const distWithManifest = (manifest: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), "federation-train-"));
    tempDirs.push(dir);
    writeFileSync(join(dir, "mf-manifest.json"), `${JSON.stringify(manifest)}\n`);
    return dir;
  };

  it("passes when the stamp matches the expected train", () => {
    const check = checkFederationTrain(
      distWithManifest({ shared: [{ name: "every-plugin", version: "2.10.1" }] }),
      "2.10.1",
    );
    expect(check).toEqual({ ok: true, stamp: "2.10.1" });
  });

  it("fails on a stale train and reports the stamped version", () => {
    const check = checkFederationTrain(
      distWithManifest({ shared: [{ name: "every-plugin", version: "2.10.1" }] }),
      "3.0.0-rc.0",
    );
    expect(check).toEqual({ ok: false, reason: "mismatch", stamp: "2.10.1" });
  });

  it("fails when the dist predates federation metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "federation-train-"));
    tempDirs.push(dir);
    expect(checkFederationTrain(dir, "2.10.1")).toEqual({
      ok: false,
      reason: "missing-manifest",
      stamp: null,
    });
  });

  it("fails when the manifest shares no every-plugin entry", () => {
    const check = checkFederationTrain(
      distWithManifest({ shared: [{ name: "zod", version: "4.6.5" }] }),
      "2.10.1",
    );
    expect(check).toEqual({ ok: false, reason: "no-stamp", stamp: null });
  });
});
