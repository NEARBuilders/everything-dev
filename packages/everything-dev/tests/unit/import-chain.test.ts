import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  configEntryAt,
  fetchSourceWithPinFallback,
  localWorkspaceSlotOf,
  resolveImportChain,
  resolvePinnedSha,
  type VersionManifestFetcher,
} from "../../src/cli/import";
import { resetConfigPathCache } from "../../src/config";
import type { ResolutionIo } from "../../src/resolution/session";

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

describe("bos import — configEntryAt / resolvePinnedSha", () => {
  it("reads the entry for app.<key> slots", () => {
    const config = { app: { auth: { pin: { manifest: "versions/a.json" } } } };
    expect(configEntryAt(config, "app.auth")).toMatchObject({
      pin: { manifest: "versions/a.json" },
    });
    expect(configEntryAt(config, "plugins.auth")).toBeNull();
  });

  it("warns and returns no sha when there is no pin or production URL", async () => {
    const result = await resolvePinnedSha({ development: "local:api" });
    expect(result.sha).toBeUndefined();
    expect(result.warning).toContain("no pinned version manifest");
  });

  it("resolves the pinned git sha from the version manifest", async () => {
    const fetcher: VersionManifestFetcher = async (url) => {
      expect(url).toBe("https://cdn.test/base/auth/versions/abc.json");
      return { gitSha: "deadbeef" };
    };
    const result = await resolvePinnedSha(
      {
        production: "https://cdn.test/base/auth/",
        pin: { manifest: "versions/abc.json", integrity: "sha384-x" },
      },
      fetcher,
    );
    expect(result).toEqual({ sha: "deadbeef" });
  });

  it("warns when the manifest records no git sha", async () => {
    const fetcher: VersionManifestFetcher = async () => ({});
    const result = await resolvePinnedSha(
      {
        production: "https://cdn.test/base/auth/",
        pin: { manifest: "versions/abc.json", integrity: "sha384-x" },
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
    const resolved = await resolveImportChain({
      workspace: WS,
      projectDir: childDir,
      io: ioWithChain({
        "bos://base.near/base": baseConfig({
          repository: "https://github.com/base/runtime",
          appAuth: {
            production: "https://cdn.test/base/auth/",
            pin: { manifest: "versions/abc.json", integrity: "sha384-x" },
          },
        }),
      }),
      fetchVersionManifest: async (url) => {
        expect(url).toBe("https://cdn.test/base/auth/versions/abc.json");
        return { gitSha: "deadbeef" };
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

  it("errors when the declaring ancestor and all ancestors above lack a repository", async () => {
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
