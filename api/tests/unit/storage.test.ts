import { describe, expect, it } from "vitest";
import {
  BUNDLE_MIME_TYPES,
  buildBundleKey,
  bundleCacheControl,
  bundleContentType,
  computeObjectIntegrity,
  MemoryStorageClient,
  validateNamespacePart,
  validateObjectPath,
  validateUploadSize,
} from "../../src/services/storage";

describe("bundle name → response policy", () => {
  it("marks hashed chunks immutable and entrypoints revalidating", () => {
    expect(bundleCacheControl("ui.1234abcd5678ef90.js")).toContain("immutable");
    expect(bundleCacheControl("remoteEntry.js")).toContain("must-revalidate");
    expect(bundleCacheControl("remoteEntry.server.js")).toContain("must-revalidate");
    expect(bundleCacheControl("mf-manifest.json")).toContain("must-revalidate");
    expect(bundleCacheControl("index.html")).toContain("must-revalidate");
  });

  it("derives content types from extensions", () => {
    expect(bundleContentType("remoteEntry.js")).toBe("text/javascript");
    expect(bundleContentType("styles.css")).toBe("text/css");
    expect(bundleContentType("plugin.manifest.json")).toBe("application/json");
    expect(bundleContentType("font.woff2")).toBe("font/woff2");
    expect(bundleContentType("unknown.bin")).toBe("application/octet-stream");
    expect(Object.keys(BUNDLE_MIME_TYPES).length).toBeGreaterThan(10);
  });
});

describe("namespace + object path validation", () => {
  it("accepts well-formed namespaces", () => {
    expect(validateNamespacePart("v1.citynode.near", "account")).toBe(true);
    expect(validateNamespacePart("citynode.app", "gateway")).toBe(true);
    expect(validateNamespacePart("my-plugin_1", "workspace")).toBe(true);
  });

  it("rejects malformed namespaces", () => {
    for (const [value, kind] of [
      ["../etc", "account"],
      [".", "gateway"],
      ["a/b", "workspace"],
      ["", "account"],
      ["a b", "gateway"],
    ] as const) {
      expect(validateNamespacePart(value, kind)).toBe(false);
    }
  });

  it("normalizes safe object paths into the workspace key", () => {
    expect(buildBundleKey("a.near", "app.dev", "ui", "remoteEntry.js")).toBe(
      "bundles/a.near/app.dev/ui/remoteEntry.js",
    );
    expect(buildBundleKey("a.near", "app.dev", "ui", "static/js/async/x.1234abcd.js")).toBe(
      "bundles/a.near/app.dev/ui/static/js/async/x.1234abcd.js",
    );
  });

  it("rejects traversal and absolute object paths", () => {
    for (const attempt of [
      "../etc/passwd",
      "/etc/passwd",
      "ui/../../package.json",
      "ui/..%2fpackage.json",
      "ui\\windows.js",
      "ui//double-slash.js",
      "ui/./dot.js",
      "",
    ]) {
      expect(validateObjectPath(attempt)).toBeNull();
    }
  });

  it("enforces the upload size ceiling", () => {
    const file = (size: number) => ({ path: "f.js", bytes: new Uint8Array(size) });
    expect(validateUploadSize([file(10), file(20)], 100)).toBe(true);
    expect(validateUploadSize([file(60), file(60)], 100)).toBe(false);
    expect(validateUploadSize([], 100)).toBe(true);
  });
});

describe("integrity", () => {
  it("computes sha384 SRI over stored bytes", () => {
    const hash = computeObjectIntegrity(new TextEncoder().encode("hello"));
    expect(hash).toMatch(/^sha384-[A-Za-z0-9+/=]{64}$/);
  });
});

describe("memory storage client", () => {
  it("round-trips objects with headers intact", async () => {
    const client = new MemoryStorageClient();
    const bytes = new TextEncoder().encode("export {}");
    await client.put({
      key: "bundles/a.near/app.dev/ui/remoteEntry.js",
      bytes,
      contentType: "text/javascript",
      cacheControl: "public, max-age=0, must-revalidate",
    });
    const got = await client.get("bundles/a.near/app.dev/ui/remoteEntry.js");
    expect(got).not.toBeNull();
    expect(got!.bytes).toEqual(bytes);
    expect(got!.contentType).toBe("text/javascript");
    expect(got!.cacheControl).toContain("must-revalidate");
    expect(await client.get("bundles/a.near/app.dev/ui/missing.js")).toBeNull();
  });
});
