import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type VerifyReport,
  verifyPublishedPins,
  verifyReleaseFreshness,
} from "../../src/services/deploy/verify";
import type { BosConfigInput } from "../../src/types";

const { readManifestTagMock } = vi.hoisted(() => ({ readManifestTagMock: vi.fn() }));

vi.mock("../../src/services/registry/pointer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/registry/pointer")>();
  return { ...actual, readManifestTag: readManifestTagMock };
});

const sriOf = (content: string): string =>
  `sha384-${createHash("sha384").update(content).digest("base64")}`;

/** A fixture CDN: objects keyed by path, the manifest composed to match. */
function fixtureCdn(objects: Record<string, string>) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https:\/\/cdn\.test/, "");
    const body = objects[path];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  };
}

const dirId = "0123456789abcdef";
const manifestDoc = (files: Record<string, string>, dir?: string): string =>
  JSON.stringify({
    version: "8f3ac1d2feedbeef",
    entry: "remoteEntry.8f3a.js",
    entryIntegrity: "sha384-entry",
    ...(dir ? { dir } : {}),
    files,
  });

const configWithPin = (integrity: string): BosConfigInput =>
  ({
    account: "a.test",
    domain: "gw.test",
    app: {
      auth: {
        production: "https://cdn.test/bundles/a.test/gw.test/auth/",
        digest: { manifest: "versions/8f3ac1d2feedbeef.json", integrity },
      },
    },
  }) as BosConfigInput;

describe("verifyPublishedPins", () => {
  it("verifies the manifest SRI and every file in the version directory (#826)", async () => {
    const entry = "console.log('entry');";
    const chunk = "console.log('expose');";
    const files = {
      "remoteEntry.8f3a.js": sriOf(entry),
      "__federation_expose_plugin.js": sriOf(chunk),
    };
    const dir = `versions/${dirId}`;
    const objects: Record<string, string> = {
      "/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json": manifestDoc(files, dir),
      ["/bundles/a.test/gw.test/auth/" + dir + "/remoteEntry.8f3a.js"]: entry,
      ["/bundles/a.test/gw.test/auth/" + dir + "/__federation_expose_plugin.js"]: chunk,
    };
    const report: VerifyReport = await verifyPublishedPins({
      config: configWithPin(
        sriOf(objects["/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json"]),
      ),
      fetchImpl: fixtureCdn(objects),
    });
    expect(report.remotes).toHaveLength(1);
    const remote = report.remotes[0]!;
    expect(remote.manifestOk).toBe(true);
    expect(remote.legacy).toBe(false);
    expect(remote.dir).toBe(`versions/${dirId}`);
    expect(remote.filesChecked).toBe(2);
    expect(remote.mismatches).toEqual([]);
  });

  it("names the file whose served bytes drifted from the pin", async () => {
    const entry = "console.log('entry');";
    const files = { "__federation_expose_plugin.js": sriOf("console.log('expose');") };
    const dir = `versions/${dirId}`;
    const objects: Record<string, string> = {
      "/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json": manifestDoc(files, dir),
      ["/bundles/a.test/gw.test/auth/" + dir + "/remoteEntry.8f3a.js"]: entry,
      // the parent republished: the expose chunk is now DIFFERENT bytes
      ["/bundles/a.test/gw.test/auth/" + dir + "/__federation_expose_plugin.js"]:
        "console.log('parent overwrote this');",
    };
    const report = await verifyPublishedPins({
      config: configWithPin(
        sriOf(objects["/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json"]),
      ),
      fetchImpl: fixtureCdn(objects),
    });
    const remote = report.remotes[0]!;
    expect(remote.manifestOk).toBe(true);
    expect(remote.mismatches).toHaveLength(1);
    expect(remote.mismatches[0]!.file).toBe("__federation_expose_plugin.js");
    expect(remote.mismatches[0]!.actual).toBe(sriOf("console.log('parent overwrote this');"));
    expect(remote.mismatches[0]!.expected).toBe(files["__federation_expose_plugin.js"]);
  });

  it("fails the manifest leg when the pinned document's SRI no longer matches", async () => {
    const objects: Record<string, string> = {
      "/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json": manifestDoc({}),
    };
    const report = await verifyPublishedPins({
      config: configWithPin("sha384-not-the-served-bytes"),
      fetchImpl: fixtureCdn(objects),
    });
    const remote = report.remotes[0]!;
    expect(remote.manifestOk).toBe(false);
    expect(remote.manifestReason).toContain("SRI mismatch");
    expect(remote.filesChecked).toBe(0);
  });

  it("resolves legacy pins (no dir) against the slot root", async () => {
    const entry = "console.log('entry');";
    const files = { "remoteEntry.8f3a.js": sriOf(entry), "138.js": sriOf("chunk") };
    const objects: Record<string, string> = {
      "/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json": manifestDoc(files),
      "/bundles/a.test/gw.test/auth/remoteEntry.8f3a.js": entry,
      "/bundles/a.test/gw.test/auth/138.js": "chunk the parent republished",
    };
    const report = await verifyPublishedPins({
      config: configWithPin(
        sriOf(objects["/bundles/a.test/gw.test/auth/versions/8f3ac1d2feedbeef.json"]),
      ),
      fetchImpl: fixtureCdn(objects),
    });
    const remote = report.remotes[0]!;
    expect(remote.legacy).toBe(true);
    expect(remote.dir).toBeUndefined();
    // the numeric chunk was clobbered at the slot root — the legacy rot
    expect(remote.mismatches).toHaveLength(1);
    expect(remote.mismatches[0]!.file).toBe("138.js");
  });
});

describe("verifyReleaseFreshness", () => {
  it("flags a child behind the parent's live release as advisory drift", async () => {
    readManifestTagMock.mockResolvedValue({
      schemaVersion: 1,
      version: "2.0.0-rc.41",
      digest: "d",
    });
    const freshness = await verifyReleaseFreshness({
      config: {
        extends: "bos://dev.everything.near/everything.dev",
        release: "2.0.0-rc.39",
      } as BosConfigInput,
    });
    expect(freshness?.behind).toBe(true);
    expect(freshness?.pinned).toBe("2.0.0-rc.39");
    expect(freshness?.published).toBe("2.0.0-rc.41");
    expect(freshness?.message).toContain("bos upgrade");
  });

  it("is undefined without a release pin or extends chain", async () => {
    readManifestTagMock.mockResolvedValue({
      schemaVersion: 1,
      version: "2.0.0-rc.41",
      digest: "d",
    });
    expect(
      await verifyReleaseFreshness({ config: { domain: "gw.test" } as BosConfigInput }),
    ).toBeUndefined();
  });
});
