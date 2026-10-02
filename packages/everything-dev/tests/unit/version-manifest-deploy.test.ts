import { describe, expect, it } from "vitest";
import { composeWorkspaceVersionManifest } from "../../src/version-manifest-deploy";

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
});
