import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { create as tarCreate } from "tar";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  buildImportReport,
  configEntryAt,
  fetchSourceWithPinFallback,
  localWorkspaceSlotOf,
  resolveImportChain,
  resolvePinnedSource,
  type VersionManifestFetcher,
} from "../../src/cli/import";
import { resetConfigPathCache } from "../../src/config";
import { computeSriHash } from "../../src/services/deploy/integrity";
import type { ResolutionIo } from "../../src/services/resolution/session";

const WS = "plugins/auth";
const SCRATCH = join(import.meta.dirname, "..", "fixtures", "bos-import-chain-scratch");

const baseConfig = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
  const { appAuth, ...rest } = overrides;
  const app: Record<string, unknown> = {
    auth: {
      development: `local:${WS}`,
      name: "@everything-dev/auth-plugin",
      ...(appAuth as Record<string, unknown> | undefined),
    },
  };
  return { account: "base.near", ...rest, app };
};

const grandparentConfig = {
  account: "root.near",
  repository: "https://github.com/root/runtime",
  app: {},
};

function ioWithChain(configs: Record<string, Record<string, unknown>>): ResolutionIo {
  return {
    fetchBosConfig: async (bosUrl: string) => {
      const config = configs[bosUrl];
      if (!config) throw new Error(`No config found for ${bosUrl}`);
      return config;
    },
    readFileOrNull: async () => null,
    importModule: async (path: string) => import(pathToFileURL(path).href),
  };
}

const manifestBytes = (
  manifest: Record<string, unknown>,
): {
  bytes: Uint8Array;
  integrity: string;
} => {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(manifest), "utf-8"));
  return { bytes, integrity: computeSriHash(Buffer.from(bytes)) };
};

let childDir: string;
const scratchDirs: string[] = [];

const writeChild = (options: { extendsRef?: string; localAuth?: boolean } = {}): string => {
  const dir = join(SCRATCH, `child-${scratchDirs.length}`);
  mkdirSync(dir, { recursive: true });
  scratchDirs.push(dir);
  const parts = [
    options.extendsRef ? `  extends: ${JSON.stringify(options.extendsRef)},` : "",
    `  name: "child.test",`,
    `  account: "child.near",`,
    options.localAuth ? `  auth: Plugin("auth").path(${JSON.stringify(WS)}),` : "",
  ].filter(Boolean);
  writeFileSync(
    join(dir, "bos.app.ts"),
    `import { App, Plugin } from "everything-dev/descriptor";

export default App({
${parts.join("\n")}
});
`,
  );
  resetConfigPathCache();
  return dir;
};

beforeAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  childDir = writeChild({ extendsRef: "bos://base.near/base" });
});

afterEach(() => {
  resetConfigPathCache();
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("bos import — localWorkspaceSlotOf", () => {
  it("matches app slot entries by local path", () => {
    const config = { app: { auth: { development: "local:plugins/auth" } } };
    expect(localWorkspaceSlotOf(config, WS)).toEqual({ slot: "app.auth" });
  });

  it("matches plugin entries by local path", () => {
    const config = { plugins: { ai: { development: "local:plugins/ai" } } };
    expect(localWorkspaceSlotOf(config, "plugins/ai")).toEqual({ slot: "plugins.ai" });
  });

  it("does not match remote declarations or plain paths", () => {
    expect(
      localWorkspaceSlotOf({ plugins: { auth: { development: "https://cdn/auth/" } } }, WS),
    ).toBeNull();
    expect(
      localWorkspaceSlotOf({ plugins: { auth: { development: "plugins/auth" } } }, WS),
    ).toBeNull();
    expect(localWorkspaceSlotOf({}, WS)).toBeNull();
    expect(localWorkspaceSlotOf(null, WS)).toBeNull();
  });
});

describe("bos import — configEntryAt / resolvePinnedSource", () => {
  it("reads the entry for app.<key> slots", () => {
    const config = { app: { auth: { pin: { manifest: "versions/a.json" } } } };
    expect(configEntryAt(config, "app.auth")).toMatchObject({
      pin: { manifest: "versions/a.json" },
    });
    expect(configEntryAt(config, "plugins.auth")).toBeNull();
  });

  it("warns and returns no sha when there is no pin or production URL", async () => {
    const result = await resolvePinnedSource({ development: "local:api" });
    expect(result.sha).toBeUndefined();
    expect(result.warning).toContain("no pinned version manifest");
  });

  it("verifies the manifest bytes against the pin integrity and returns sha + source from one fetch", async () => {
    const manifest = {
      gitSha: "deadbeef",
      source: { file: "source/auth.tar.gz", integrity: "sha384-abc" },
    };
    const { bytes, integrity } = manifestBytes(manifest);
    let calls = 0;
    const fetcher: VersionManifestFetcher = async (url) => {
      calls++;
      expect(url).toBe("https://cdn.test/base/auth/versions/abc.json");
      return { bytes, manifest };
    };
    const result = await resolvePinnedSource(
      {
        production: "https://cdn.test/base/auth/",
        pin: { manifest: "versions/abc.json", integrity },
      },
      fetcher,
    );
    expect(calls).toBe(1);
    expect(result).toEqual({
      sha: "deadbeef",
      source: { file: "source/auth.tar.gz", integrity: "sha384-abc" },
    });
  });

  it("throws a hard error when the manifest bytes do not match the pin integrity", async () => {
    const { bytes } = manifestBytes({ gitSha: "deadbeef" });
    const fetcher: VersionManifestFetcher = async () => ({
      bytes,
      manifest: { gitSha: "deadbeef" },
    });
    await expect(
      resolvePinnedSource(
        {
          production: "https://cdn.test/base/auth/",
          pin: { manifest: "versions/abc.json", integrity: "sha384-tampered" },
        },
        fetcher,
      ),
    ).rejects.toThrow(/integrity/);
  });

  it("keeps the warning path when the pin carries no integrity", async () => {
    const fetcher: VersionManifestFetcher = async () => ({ bytes: new Uint8Array(), manifest: {} });
    const result = await resolvePinnedSource(
      {
        production: "https://cdn.test/base/auth/",
        pin: { manifest: "versions/abc.json" },
      },
      fetcher,
    );
    expect(result.sha).toBeUndefined();
    expect(result.warning).toContain("no git sha");
  });

  it("warns when the manifest records no git sha (pin integrity verified)", async () => {
    const { bytes, integrity } = manifestBytes({});
    const fetcher: VersionManifestFetcher = async () => ({ bytes, manifest: {} });
    const result = await resolvePinnedSource(
      {
        production: "https://cdn.test/base/auth/",
        pin: { manifest: "versions/abc.json", integrity },
      },
      fetcher,
    );
    expect(result.sha).toBeUndefined();
    expect(result.warning).toContain("no git sha");
  });
});

describe("bos import — fetchSourceWithPinFallback", () => {
  const tarball = (tag: string) => ({
    dir: `/tmp/${tag}`,
    cleanup: async () => {},
    resolvedRef: tag,
    resolvedSha: `sha-${tag}`,
  });

  it("downloads the pinned ref when it fetches cleanly", async () => {
    const refs: Array<string | undefined> = [];
    const result = await fetchSourceWithPinFallback({
      spec: { kind: "github", repo: "https://github.com/a/b", ref: "deadbeef" },
      pinnedSha: "deadbeef",
      download: async (_repo, ref) => {
        refs.push(ref);
        return tarball(ref ?? "main");
      },
    });
    expect(refs).toEqual(["deadbeef"]);
    expect(result.source.ref).toBe("deadbeef");
    expect(result.fallbackWarning).toBeUndefined();
  });

  it("falls back to the default branch when the pinned commit does not fetch", async () => {
    const refs: Array<string | undefined> = [];
    const result = await fetchSourceWithPinFallback({
      spec: { kind: "github", repo: "https://github.com/a/b", ref: "deadbeef" },
      pinnedSha: "deadbeef",
      download: async (_repo, ref) => {
        refs.push(ref);
        if (ref) throw new Error(`ref ${ref} not found`);
        return tarball("main");
      },
    });
    expect(refs).toEqual(["deadbeef", undefined]);
    expect(result.source.ref).toBe("main");
    expect(result.fallbackWarning).toContain("deadbeef");
    expect(result.fallbackWarning).toContain("default branch");
  });

  it("propagates failure when the ref was not chain-pinned", async () => {
    await expect(
      fetchSourceWithPinFallback({
        spec: { kind: "github", repo: "https://github.com/a/b", ref: "v1" },
        download: async () => {
          throw new Error("network down");
        },
      }),
    ).rejects.toThrow("network down");
  });

  it("passes local specs through untouched", async () => {
    const result = await fetchSourceWithPinFallback({
      spec: { kind: "local", dir: "/somewhere" },
      pinnedSha: "deadbeef",
      download: async () => {
        throw new Error("must not download");
      },
    });
    expect(result.source).toMatchObject({ root: "/somewhere", ref: "local" });
  });

  describe("archive branch", () => {
    let archiveDir: string;
    let archive: { bytes: Uint8Array; integrity: string };

    const makeArchive = async (): Promise<{ bytes: Uint8Array; integrity: string }> => {
      const srcDir = join(archiveDir, "repo-root");
      mkdirSync(join(srcDir, "plugins", "auth", "src"), { recursive: true });
      writeFileSync(
        join(srcDir, "plugins", "auth", "src", "index.ts"),
        "export const auth = true;\n",
      );
      writeFileSync(join(srcDir, "plugins", "auth", "package.json"), '{"name":"auth"}\n');
      const tarPath = join(archiveDir, "source.tar.gz");
      await tarCreate({ gzip: true, cwd: srcDir, file: tarPath, portable: true }, ["plugins"]);
      const bytes = new Uint8Array(readFileSync(tarPath));
      return { bytes, integrity: computeSriHash(Buffer.from(bytes)) };
    };

    beforeAll(async () => {
      archiveDir = mkdtempSync(join(SCRATCH, "archive-"));
      archive = await makeArchive();
    });

    it("extracts a verified archive to a temp dir with cleanup wired", async () => {
      const result = await fetchSourceWithPinFallback({
        spec: {
          kind: "archive",
          url: "https://cdn.test/base/auth/source/auth.tar.gz",
          integrity: archive.integrity,
        },
        fetchArchive: async () => archive.bytes,
      });
      expect(result.source.ref).toBe("source archive");
      expect(result.fallbackWarning).toBeUndefined();
      expect(
        readFileSync(join(result.source.root, "plugins", "auth", "src", "index.ts"), "utf-8"),
      ).toContain("export const auth");
      await result.source.cleanup();
      expect(existsSync(result.source.root)).toBe(false);
    });

    it("falls back to github when the archive fetch fails and a fallback exists", async () => {
      const result = await fetchSourceWithPinFallback({
        spec: {
          kind: "archive",
          url: "https://cdn.test/base/auth/source/auth.tar.gz",
          integrity: archive.integrity,
        },
        pinnedSha: "deadbeef",
        fetchArchive: async () => {
          throw new Error("cdn down");
        },
        fallback: { repo: "https://github.com/a/b", ref: "deadbeef" },
        download: async () => tarball("deadbeef"),
      });
      expect(result.source.ref).toBe("deadbeef");
      expect(result.fallbackWarning).toContain("could not fetch the source archive");
      expect(result.fallbackWarning).toContain("cdn down");
      expect(result.fallbackWarning).toContain("https://github.com/a/b");
    });

    it("falls back to github on an integrity mismatch", async () => {
      const result = await fetchSourceWithPinFallback({
        spec: {
          kind: "archive",
          url: "https://cdn.test/base/auth/source/auth.tar.gz",
          integrity: "sha384-not-the-real-hash",
        },
        pinnedSha: "deadbeef",
        fetchArchive: async () => archive.bytes,
        fallback: { repo: "https://github.com/a/b", ref: "deadbeef" },
        download: async () => tarball("deadbeef"),
      });
      expect(result.source.ref).toBe("deadbeef");
      expect(result.fallbackWarning).toContain("could not fetch the source archive");
    });

    it("propagates the error when the archive fails with no fallback", async () => {
      await expect(
        fetchSourceWithPinFallback({
          spec: {
            kind: "archive",
            url: "https://cdn.test/base/auth/source/auth.tar.gz",
            integrity: archive.integrity,
          },
          pinnedSha: "deadbeef",
          fetchArchive: async () => {
            throw new Error("cdn down");
          },
          download: async () => {
            throw new Error("must not download");
          },
        }),
      ).rejects.toThrow("cdn down");
    });
  });
});

describe("bos import — resolveImportChain", () => {
  it("resolves the nearest ancestor declaring the workspace through the extends chain", async () => {
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({
        "bos://base.near/base": baseConfig({ repository: "https://github.com/base/runtime" }),
      }),
    });

    expect(resolved.spec).toEqual({
      kind: "github",
      repo: "https://github.com/base/runtime",
    });
    expect(resolved.provenance.ancestorRef).toBe("bos://base.near/base");
    expect(resolved.provenance.extendsRef).toBe("bos://base.near/base");
    expect(resolved.provenance.warnings[0]).toContain("no pinned version manifest");
  });

  it("falls back rootward for the repository when the declaring ancestor lacks one", async () => {
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({
        "bos://base.near/base": baseConfig({ extends: "bos://root.near/root" }),
        "bos://root.near/root": grandparentConfig,
      }),
    });

    expect(resolved.spec).toEqual({
      kind: "github",
      repo: "https://github.com/root/runtime",
    });
    expect(resolved.provenance.ancestorRef).toBe("bos://base.near/base");
  });

  it("prefers the declaring ancestor's repository over the root's when both declare one", async () => {
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({
        "bos://base.near/base": baseConfig({
          repository: "https://github.com/base/runtime",
          extends: "bos://root.near/root",
        }),
        "bos://root.near/root": {
          ...grandparentConfig,
          repository: "https://github.com/root/runtime",
        },
      }),
    });

    expect(resolved.spec).toEqual({ kind: "github", repo: "https://github.com/base/runtime" });
    expect(resolved.provenance.ancestorRef).toBe("bos://base.near/base");
  });

  it("pins the ref to the ancestor's version-manifest git sha", async () => {
    const manifest = { gitSha: "deadbeef" };
    const { bytes, integrity } = manifestBytes(manifest);
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({
        "bos://base.near/base": baseConfig({
          repository: "https://github.com/base/runtime",
          appAuth: {
            production: "https://cdn.test/base/auth/",
            pin: { manifest: "versions/abc.json", integrity },
          },
        }),
      }),
      fetchVersionManifest: async (url) => {
        expect(url).toBe("https://cdn.test/base/auth/versions/abc.json");
        return { bytes, manifest };
      },
    });

    expect(resolved.spec).toEqual({
      kind: "github",
      repo: "https://github.com/base/runtime",
      ref: "deadbeef",
    });
    expect(resolved.provenance.pinnedSha).toBe("deadbeef");
    expect(resolved.provenance.warnings).toEqual([]);
  });

  it("imports from the source archive when the manifest carries one, even with no repository", async () => {
    const manifest = {
      gitSha: "deadbeef",
      source: { file: "source/auth.tar.gz", integrity: "sha384-abc" },
    };
    const { bytes, integrity } = manifestBytes(manifest);
    const repolessBase = baseConfig({
      appAuth: {
        production: "https://cdn.test/base/auth/",
        pin: { manifest: "versions/abc.json", integrity },
      },
    });
    delete repolessBase.repository;
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({ "bos://base.near/base": repolessBase }),
      fetchVersionManifest: async () => ({ bytes, manifest }),
    });

    expect(resolved.spec).toEqual({
      kind: "archive",
      url: "https://cdn.test/base/auth/source/auth.tar.gz",
      integrity: "sha384-abc",
    });
    expect(resolved.provenance.sourceArchive).toEqual({
      file: "source/auth.tar.gz",
      url: "https://cdn.test/base/auth/source/auth.tar.gz",
      integrity: "sha384-abc",
    });
    expect(resolved.provenance.pinnedSha).toBe("deadbeef");
    expect(resolved.provenance.repository).toBeUndefined();
  });

  it("keeps the repository rootward as the github fallback coordinate alongside the archive", async () => {
    const manifest = {
      gitSha: "deadbeef",
      source: { file: "source/auth.tar.gz", integrity: "sha384-abc" },
    };
    const { bytes, integrity } = manifestBytes(manifest);
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({
        "bos://base.near/base": baseConfig({
          extends: "bos://root.near/root",
          appAuth: {
            production: "https://cdn.test/base/auth/",
            pin: { manifest: "versions/abc.json", integrity },
          },
        }),
        "bos://root.near/root": grandparentConfig,
      }),
      fetchVersionManifest: async () => ({ bytes, manifest }),
    });

    expect(resolved.spec).toEqual({
      kind: "archive",
      url: "https://cdn.test/base/auth/source/auth.tar.gz",
      integrity: "sha384-abc",
    });
    expect(resolved.provenance.repository).toBe("https://github.com/root/runtime");
    expect(resolved.provenance.sourceArchive).toBeDefined();
  });

  it("errors when the child itself declares the workspace locally", async () => {
    const localChild = writeChild({ extendsRef: "bos://base.near/base", localAuth: true });
    try {
      await expect(
        resolveImportChain({
          workspace: WS,
          projectDir: localChild,
          io: ioWithChain({ "bos://base.near/base": baseConfig() }),
        }),
      ).rejects.toThrow("is declared locally in your authored config");
    } finally {
      rmSync(localChild, { recursive: true, force: true });
    }
  });

  it("errors when no runtime in the chain declares the workspace", async () => {
    const otherChild = writeChild({ extendsRef: "bos://grand.near/root" });
    try {
      await expect(
        resolveImportChain({
          workspace: WS,
          projectDir: otherChild,
          io: ioWithChain({ "bos://grand.near/root": grandparentConfig }),
        }),
      ).rejects.toThrow(`No runtime in the extends chain declares workspace "${WS}"`);
    } finally {
      rmSync(otherChild, { recursive: true, force: true });
    }
  });

  it("errors when the declaring ancestor and all ancestors above lack a repository and no source archive exists", async () => {
    const repolessBase = baseConfig({ repository: undefined });
    delete repolessBase.repository;
    await expect(
      resolveImportChain({
        workspace: WS,
        projectDir: childDir,
        io: ioWithChain({ "bos://base.near/base": repolessBase }),
      }),
    ).rejects.toThrow("No repository found along the extends chain");
  });
});

describe("bos import — report provenance", () => {
  it("lists the source archive coordinate when the archive path was taken", () => {
    const report = buildImportReport(
      {
        workspace: WS,
        from: "bos://base.near/base",
        ref: "source archive",
        sourceKind: "archive",
        chain: {
          extendsRef: "bos://base.near/base",
          ancestorRef: "bos://base.near/base",
          warnings: [],
          sourceArchive: {
            file: "source/auth.tar.gz",
            url: "https://cdn.test/base/auth/source/auth.tar.gz",
            integrity: "sha384-abc",
          },
        },
        added: [],
        updated: [],
        unchanged: [],
        preservedLocal: [],
        preservedLocalEdit: [],
        merged: [],
        conflicts: [],
        migrationCollisions: [],
        migrationReconciliation: null,
        heldBackMigrations: [],
      },
      { mode: "dry-run" },
    );
    expect(report).toContain(
      "- **Source archive:** `https://cdn.test/base/auth/source/auth.tar.gz`",
    );
  });
});
