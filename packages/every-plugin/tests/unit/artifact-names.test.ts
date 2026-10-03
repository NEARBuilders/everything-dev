import { describe, expect, it } from "vitest";
import {
  BuildEntryReportSchema,
  cacheControlOf,
  contentHashOf,
  findHashedEntry,
  hashedArtifactName,
  planArtifactCopies,
} from "../../src/build/artifact-names";

describe("classifyBundlePath / cacheControlOf", () => {
  it("serves content-hashed files immutable, including hashed entrypoints", () => {
    for (const name of [
      "remoteEntry.8f3ac1d2feedbeef.js",
      "remoteEntry.server.a71fb2c3d4e5f601.js",
      "mf-manifest.9d2e1a3b5c7d9021.json",
      "style.6c596dfcdd12ab34.css",
      "ih.2afef425219df3be.js",
      "k.9c8699d5a5.js",
      "static/js/async/ih.2afef425219df3be.js",
    ]) {
      expect(cacheControlOf(name), name).toBe("public, max-age=31536000, immutable");
    }
  });

  it("serves fixed-name entrypoints and non-hashed files must-revalidate", () => {
    for (const name of [
      "remoteEntry.js",
      "remoteEntry.server.js",
      "mf-manifest.json",
      "manifest.gen.json",
      "index.html",
      "skill.md",
      "favicon.ico",
      "138.js",
      "style.css",
    ]) {
      expect(cacheControlOf(name), name).toBe("public, max-age=0, must-revalidate");
    }
  });
});

describe("contentHashOf", () => {
  it("is deterministic, content-sensitive, and 16 hex chars", () => {
    const a = contentHashOf("hello");
    const b = contentHashOf("hello");
    const c = contentHashOf("hello ");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("hashedArtifactName", () => {
  it("inserts the hash segment before the extension", () => {
    expect(hashedArtifactName("remoteEntry", "8f3ac1d2feedbeef", "js")).toBe(
      "remoteEntry.8f3ac1d2feedbeef.js",
    );
    expect(hashedArtifactName("mf-manifest", "9d2e1a3b5c7d9021", "json")).toBe(
      "mf-manifest.9d2e1a3b5c7d9021.json",
    );
    expect(hashedArtifactName("style", "6c596dfcdd12ab34", "css")).toBe(
      "style.6c596dfcdd12ab34.css",
    );
  });
});

describe("findHashedEntry", () => {
  it("finds the hashed entry for a base name", () => {
    const entry = findHashedEntry(
      ["remoteEntry.8f3ac1d2feedbeef.js", "remoteEntry.js", "static/js/async/ih.2afef.js"],
      "remoteEntry",
    );
    expect(entry).toBe("remoteEntry.8f3ac1d2feedbeef.js");
  });

  it("finds the server entry base independently", () => {
    const entry = findHashedEntry(["remoteEntry.server.9d2e1a3b.js"], "remoteEntry.server");
    expect(entry).toBe("remoteEntry.server.9d2e1a3b.js");
  });

  it("returns null when only the fixed name exists (pre-hashed build)", () => {
    expect(findHashedEntry(["remoteEntry.js"], "remoteEntry")).toBeNull();
  });

  it("never matches a hashed name onto a different base", () => {
    expect(findHashedEntry(["remoteEntry.8f3ac1d2.js"], "remoteEntry.server")).toBeNull();
  });
});

describe("BuildEntryReportSchema", () => {
  it("parses the web-env report shape", () => {
    const parsed = BuildEntryReportSchema.parse({
      entry: "remoteEntry.8f3ac1d2feedbeef.js",
      browserManifest: "mf-manifest.9d2e1a3b5c7d9021.json",
      css: "style.6c596dfcdd12ab34.css",
    });
    expect(parsed.entry).toBe("remoteEntry.8f3ac1d2feedbeef.js");
  });

  it("parses the ssr report shape (entry only)", () => {
    const parsed = BuildEntryReportSchema.parse({ entry: "remoteEntry.server.9d2e1a3b.js" });
    expect(parsed.browserManifest).toBeUndefined();
    expect(parsed.css).toBeUndefined();
  });
});

describe("planArtifactCopies", () => {
  it("plans the hashed manifest and css copies, and the report", () => {
    const manifestContent = JSON.stringify({ metaData: { publicPath: "auto" } });
    const cssContent = ".box{color:red}";
    const manifestHash = contentHashOf(manifestContent);
    const cssHash = contentHashOf(cssContent);

    const plan = planArtifactCopies({
      assetNames: ["remoteEntry.8f3ac1d2feedbeef.js", "mf-manifest.json", "style.css"],
      entryBase: "remoteEntry",
      contents: { "mf-manifest.json": manifestContent, "style.css": cssContent },
    });

    expect(plan.copies).toEqual([
      {
        from: "mf-manifest.json",
        to: `mf-manifest.${manifestHash}.json`,
      },
      { from: "style.css", to: `style.${cssHash}.css` },
    ]);
    expect(plan.report).toEqual({
      entry: "remoteEntry.8f3ac1d2feedbeef.js",
      browserManifest: `mf-manifest.${manifestHash}.json`,
      css: `style.${cssHash}.css`,
    });
  });

  it("plans no copies for the ssr dist root (entry only in the report)", () => {
    const plan = planArtifactCopies({
      assetNames: ["remoteEntry.server.9d2e1a3b5c7d9021.js", "mf-manifest.json"],
      entryBase: "remoteEntry.server",
      contents: {},
    });
    expect(plan.copies).toEqual([]);
    expect(plan.report).toEqual({ entry: "remoteEntry.server.9d2e1a3b5c7d9021.js" });
  });

  it("degrades to no plan when only fixed names exist", () => {
    const plan = planArtifactCopies({
      assetNames: ["remoteEntry.js", "mf-manifest.json"],
      entryBase: "remoteEntry",
      contents: { "mf-manifest.json": "{}" },
    });
    expect(plan).toBeNull();
  });
});
