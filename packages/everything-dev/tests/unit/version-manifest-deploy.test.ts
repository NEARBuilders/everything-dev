import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  composeWorkspaceVersionManifest,
  resolveRemoteVersion,
} from "../../src/services/deploy/version-manifest";

const webReport = {
  entry: "remoteEntry.cf712c39e56dc37f.js",
  browserManifest: "mf-manifest.f28865c6f7d48917.json",
  css: "style.a1388dfa8e78c42b.css",
};
const ssrReport = { entry: "remoteEntry.server.153cffaa67fea40a.js" };

describe("composeWorkspaceVersionManifest", () => {
  it("composes the ui manifest from the server-computed SRI map + build reports", () => {
    const manifest = composeWorkspaceVersionManifest({
      report: webReport,
      ssrReport,
      integrityMap: {
        "remoteEntry.cf712c39e56dc37f.js": "sha384-entry",
        "ssr/remoteEntry.server.153cffaa67fea40a.js": "sha384-ssr",
        "mf-manifest.f28865c6f7d48917.json": "sha384-manifest",
        "style.a1388dfa8e78c42b.css": "sha384-css",
      },
    });
    expect(manifest.entry).toBe("remoteEntry.cf712c39e56dc37f.js");
    expect(manifest.entryIntegrity).toBe("sha384-entry");
    expect(manifest.ssr).toEqual({
      entry: "ssr/remoteEntry.server.153cffaa67fea40a.js",
      integrity: "sha384-ssr",
    });
    expect(manifest.browserManifest).toEqual({
      file: "mf-manifest.f28865c6f7d48917.json",
      integrity: "sha384-manifest",
    });
    expect(manifest.assets?.css).toBe("sha384-css");
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("composes the plugin (rspack) manifest: entry only, no ssr", () => {
    const manifest = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    expect(manifest.entry).toBe("remoteEntry.83ba437f70018e7d.js");
    expect(manifest.ssr).toBeUndefined();
    expect(manifest.browserManifest).toBeUndefined();
  });

  it("returns null when the server SRI map is missing the entry (legacy dist)", () => {
    expect(
      composeWorkspaceVersionManifest({
        report: webReport,
        integrityMap: { "remoteEntry.js": "sha384-legacy" },
      }),
    ).toBeNull();
  });

  it("omits the ssr section when the ssr entry SRI is missing", () => {
    const manifest = composeWorkspaceVersionManifest({
      report: webReport,
      ssrReport,
      integrityMap: { "remoteEntry.cf712c39e56dc37f.js": "sha384-entry" },
    });
    expect(manifest.ssr).toBeUndefined();
    expect(manifest.entryIntegrity).toBe("sha384-entry");
  });

  it("threads the source archive and gitSha into the manifest and the version hash", () => {
    const base = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    const manifest = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
      source: { file: "source/source.0123456789abcdef.tar.gz", integrity: "sha384-source" },
      gitSha: "62b63bc4deadbeefcafebabe0123456789abcdef",
    });
    expect(manifest.source).toEqual({
      file: "source/source.0123456789abcdef.tar.gz",
      integrity: "sha384-source",
    });
    expect(manifest.gitSha).toBe("62b63bc4deadbeefcafebabe0123456789abcdef");
    expect(manifest.version).not.toBe(base.version);
  });

  it("omits the source section and gitSha when not provided", () => {
    const manifest = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    expect(manifest.source).toBeUndefined();
    expect(manifest.gitSha).toBeUndefined();
  });

  it("threads the build report's shared record into the manifest and the version hash (#546)", () => {
    const base = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    const manifest = composeWorkspaceVersionManifest({
      report: {
        entry: "remoteEntry.83ba437f70018e7d.js",
        shared: { react: "19.2.9", "react-dom": "19.2.9" },
      },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    expect(manifest.shared).toEqual({ react: "19.2.9", "react-dom": "19.2.9" });
    expect(manifest.version).not.toBe(base.version);
  });

  it("falls back to the ssr report's shared record when the web report has none", () => {
    const manifest = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      ssrReport: { entry: "remoteEntry.server.153cffaa67fea40a.js", shared: { react: "19.2.4" } },
      integrityMap: {
        "remoteEntry.83ba437f70018e7d.js": "sha384-entry",
        "ssr/remoteEntry.server.153cffaa67fea40a.js": "sha384-ssr",
      },
    });
    expect(manifest.shared).toEqual({ react: "19.2.4" });
  });

  it("omits shared when neither report carries one — builds predating the field stay valid", () => {
    const manifest = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    expect(manifest.shared).toBeUndefined();
  });

  it("threads the version directory into the manifest and the version hash (#826)", () => {
    const base = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
    });
    expect(base.dir).toBeUndefined();
    const manifest = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
      dir: "versions/0123456789abcdef",
    });
    expect(manifest.dir).toBe("versions/0123456789abcdef");
    expect(manifest.version).not.toBe(base.version);
    const same = composeWorkspaceVersionManifest({
      report: { entry: "remoteEntry.83ba437f70018e7d.js" },
      integrityMap: { "remoteEntry.83ba437f70018e7d.js": "sha384-entry" },
      dir: "versions/0123456789abcdef",
    });
    expect(same.version).toBe(manifest.version);
  });
});

describe("resolveRemoteVersion — version directory resolution (#826)", () => {
  const base = "https://cdn.test/bundles/a.test/gw.test/ui/";
  const manifestBody = JSON.stringify({
    version: "8f3ac1d2feedbeef",
    entry: "remoteEntry.83ba437f70018e7d.js",
    entryIntegrity: "sha384-entry",
    dir: "versions/0123456789abcdef",
    files: { "manifest.gen.json": "sha384-compose" },
  });
  const digest = {
    manifest: "versions/8f3ac1d2feedbeef.json",
    integrity: `sha384-${createHash("sha384").update(manifestBody).digest("base64")}`,
  };

  it("resolves artifact coordinates through the version directory and exposes base + dir", async () => {
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith("versions/8f3ac1d2feedbeef.json")
        ? new Response(manifestBody, { status: 200 })
        : new Response("not found", { status: 404 });
    };
    const resolved = await resolveRemoteVersion({ base, digest, fetchImpl });
    expect(resolved.base).toBe(base.replace(/\/$/, ""));
    expect(resolved.dir).toBe("versions/0123456789abcdef");
    expect(resolved.entryUrl).toBe(
      `${base}versions/0123456789abcdef/remoteEntry.83ba437f70018e7d.js`,
    );
  });

  it("a legacy manifest (no dir) resolves against the slot root", async () => {
    const legacy = JSON.stringify({
      version: "8f3ac1d2feedbeef",
      entry: "remoteEntry.83ba437f70018e7d.js",
      entryIntegrity: "sha384-entry",
      files: { "manifest.gen.json": "sha384-compose" },
    });
    const legacyDigest = {
      manifest: "versions/8f3ac1d2feedbeef.json",
      integrity: `sha384-${createHash("sha384").update(legacy).digest("base64")}`,
    };
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith("versions/8f3ac1d2feedbeef.json")
        ? new Response(legacy, { status: 200 })
        : new Response("not found", { status: 404 });
    };
    const resolved = await resolveRemoteVersion({ base, digest: legacyDigest, fetchImpl });
    expect(resolved.dir).toBeUndefined();
    expect(resolved.entryUrl).toBe(`${base}remoteEntry.83ba437f70018e7d.js`);
  });
});
