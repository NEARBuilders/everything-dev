import { describe, expect, it } from "vitest";
import { composeVersionManifest, WorkspaceVersionManifestSchema } from "../../src/version-manifest";

describe("WorkspaceVersionManifestSchema", () => {
  it("parses the full document shape", () => {
    const parsed = WorkspaceVersionManifestSchema.parse({
      version: "8f3ac1d2feedbeef",
      builtAt: "2026-09-30T12:00:00.000Z",
      gitSha: "605178e8a",
      entry: "remoteEntry.8f3ac1d2.js",
      entryIntegrity: "sha384-aaa",
      ssr: { entry: "remoteEntry.server.9d2e1a3b.js", integrity: "sha384-bbb" },
      browserManifest: { file: "mf-manifest.f28865c6.json", integrity: "sha384-ccc" },
      assets: { css: "sha384-ddd" },
      shared: { react: "19.2.4" },
    });
    expect(parsed.entry).toBe("remoteEntry.8f3ac1d2.js");
    expect(parsed.ssr?.entry).toBe("remoteEntry.server.9d2e1a3b.js");
  });

  it("requires entry + entryIntegrity, tolerates everything else optional", () => {
    const parsed = WorkspaceVersionManifestSchema.parse({
      version: "8f3ac1d2feedbeef",
      builtAt: "2026-09-30T12:00:00.000Z",
      entry: "remoteEntry.8f3ac1d2.js",
      entryIntegrity: "sha384-aaa",
    });
    expect(parsed.ssr).toBeUndefined();
    expect(() => WorkspaceVersionManifestSchema.parse({ version: "x", builtAt: "t" })).toThrow();
  });
});

describe("composeVersionManifest", () => {
  it("derives version from the content of the manifest without it", () => {
    const manifest = composeVersionManifest({
      builtAt: "2026-09-30T12:00:00.000Z",
      entry: "remoteEntry.8f3ac1d2.js",
      entryIntegrity: "sha384-aaa",
      shared: { react: "19.2.4" },
    });
    expect(manifest.version).toMatch(/^[0-9a-f]{16}$/);
    expect(WorkspaceVersionManifestSchema.parse(manifest).version).toBe(manifest.version);

    // same inputs → same version; a changed entry → a different version
    const again = composeVersionManifest({
      builtAt: "2026-09-30T12:00:00.000Z",
      entry: "remoteEntry.8f3ac1d2.js",
      entryIntegrity: "sha384-aaa",
      shared: { react: "19.2.4" },
    });
    expect(again.version).toBe(manifest.version);

    const changed = composeVersionManifest({
      builtAt: "2026-09-30T12:00:00.000Z",
      entry: "remoteEntry.deadbeef.js",
      entryIntegrity: "sha384-aaa",
      shared: { react: "19.2.4" },
    });
    expect(changed.version).not.toBe(manifest.version);
  });

  it("version excludes builtAt: same bytes at different times keep the version id", () => {
    const morning = composeVersionManifest({
      builtAt: "2026-09-30T08:00:00.000Z",
      entry: "remoteEntry.8f3ac1d2.js",
      entryIntegrity: "sha384-aaa",
    });
    const evening = composeVersionManifest({
      builtAt: "2026-09-30T20:00:00.000Z",
      entry: "remoteEntry.8f3ac1d2.js",
      entryIntegrity: "sha384-aaa",
    });
    expect(morning.version).toBe(evening.version);
    expect(morning.builtAt).not.toBe(evening.builtAt);
  });

  it("canonicalization is key-order insensitive", () => {
    const a = composeVersionManifest({
      builtAt: "t",
      entry: "e.js",
      entryIntegrity: "sha384-aaa",
      ssr: { entry: "s.js", integrity: "sha384-bbb" },
    });
    const b = composeVersionManifest({
      entryIntegrity: "sha384-aaa",
      entry: "e.js",
      builtAt: "t",
      ssr: { integrity: "sha384-bbb", entry: "s.js" },
    });
    expect(a.version).toBe(b.version);
  });

  it("canonicalization is key-order insensitive inside the files map too", () => {
    const a = composeVersionManifest({
      entry: "e.js",
      entryIntegrity: "sha384-aaa",
      files: { "a.js": "sha384-aaa", "b.js": "sha384-bbb" },
    });
    const b = composeVersionManifest({
      entry: "e.js",
      entryIntegrity: "sha384-aaa",
      files: { "b.js": "sha384-bbb", "a.js": "sha384-aaa" },
    });
    expect(a.version).toBe(b.version);
  });
});

describe("files digest map", () => {
  const base = { entry: "remoteEntry.8f3ac1d2.js", entryIntegrity: "sha384-aaa" };

  it("is recorded on the manifest and participates in the version hash", () => {
    const withoutFiles = composeVersionManifest(base);
    const withFiles = composeVersionManifest({
      ...base,
      files: { "remoteEntry.8f3ac1d2.js": "sha384-bbb" },
    });
    expect(withFiles.files).toEqual({ "remoteEntry.8f3ac1d2.js": "sha384-bbb" });
    expect(withFiles.version).not.toBe(withoutFiles.version);
  });

  it("identical files map → same version id; any changed file → a new one", () => {
    const withFiles = composeVersionManifest({
      ...base,
      files: { "a.js": "sha384-bbb", "b.js": "sha384-ccc" },
    });
    const same = composeVersionManifest({
      ...base,
      files: { "b.js": "sha384-ccc", "a.js": "sha384-bbb" },
    });
    expect(same.version).toBe(withFiles.version);

    const changedFile = composeVersionManifest({
      ...base,
      files: { "a.js": "sha384-ddd", "b.js": "sha384-ccc" },
    });
    expect(changedFile.version).not.toBe(withFiles.version);
  });

  it("rejects file entries that are not sha384 SRIs", () => {
    expect(() => composeVersionManifest({ ...base, files: { "a.js": "md5-nope" } })).toThrow();
  });
});
