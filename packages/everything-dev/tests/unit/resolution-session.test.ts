import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircularExtendsError, ConfigLoadError, DevOverlayError } from "../../src/config";
import {
  openResolution,
  type ResolutionIo,
  ResolutionSession,
  type WalkLink,
  walkExtendsChain,
} from "../../src/resolution/session";
import type { BosConfigInput } from "../../src/types";

const catalogMocks = vi.hoisted(() => ({
  cleanups: [] as string[],
  configs: new Map<string, unknown>(),
  sourceDirs: new Map<string, string>(),
}));

vi.mock("../../src/cli/init", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/init")>();
  return {
    ...actual,
    resolveSourceDir: (async (opts: { extendsAccount: string; extendsGateway: string }) => {
      const ref = `bos://${opts.extendsAccount}/${opts.extendsGateway}`;
      const parentConfig = catalogMocks.configs.get(ref);
      if (parentConfig === undefined) {
        throw new Error(`No config found for ${ref}`);
      }
      return {
        parentConfig,
        sourceDir: catalogMocks.sourceDirs.get(ref) ?? null,
        cleanup: async () => {
          catalogMocks.cleanups.push(ref);
        },
      };
    }) as unknown as typeof actual.resolveSourceDir,
  };
});

const memoryIo = (
  files: Record<string, string>,
  remote: Record<string, unknown>,
): ResolutionIo => ({
  fetchBosConfig: async (url) => {
    if (!(url in remote)) throw new Error(`No config found for ${url}`);
    return remote[url];
  },
  readFileOrNull: async (path) => files[path] ?? null,
  importModule: async () => {
    throw new Error("importModule must not be reached by these fixtures");
  },
});

const openedOrError = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected openResolution to fail");
    },
    (error: unknown) => error,
  );

const devOnlyConfig: BosConfigInput = {
  account: "local.near",
  app: {
    host: { development: "local:host", production: "" },
    ui: { development: "local:ui" },
    api: { development: "local:api" },
  },
};

const leafConfig: BosConfigInput = {
  ...devOnlyConfig,
  domain: "local.dev",
  app: {
    ...devOnlyConfig.app,
    ui: { development: "local:ui", production: "https://ui.local.dev" },
  },
};

const CHILD_REF = "bos://child.near/child.dev";
const PARENT_REF = "bos://parent.near/parent.dev";
const remoteChainChild: BosConfigInput = {
  extends: PARENT_REF,
  account: "child.near",
  domain: "child.dev",
  app: { ui: { production: "https://ui.child.dev" } },
};
const remoteChainParent: BosConfigInput = {
  account: "parent.near",
  domain: "parent.dev",
  app: {
    host: { development: "local:host", production: "" },
    ui: { development: "local:ui", production: "https://ui.parent.dev" },
    api: { development: "local:api" },
  },
};

describe("openResolution", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network disabled in resolution tests");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens a local leaf config over in-memory io", async () => {
    const path = "/project/bos.config.json";
    const session = await openResolution(
      { path },
      memoryIo({ [path]: JSON.stringify(leafConfig) }, {}),
    );

    expect(session).not.toBeNull();
    expect(session?.config.account).toBe("local.near");
    expect(session?.path).toBe(path);
    expect(session?.root).toBe("/project");
    expect(session?.chain).toEqual([path]);
    expect(session?.rawConfig).toEqual(leafConfig);
    expect(session?.runtime?.env).toBe("development");
  });

  it("resolves a bos:// chain of two: chain entry-first, merged child-wins, rawConfig is the opened leaf", async () => {
    const session = await openResolution(
      { bosUrl: CHILD_REF },
      memoryIo({}, { [CHILD_REF]: remoteChainChild, [PARENT_REF]: remoteChainParent }),
    );

    expect(session).not.toBeNull();
    expect(session?.chain).toEqual([CHILD_REF, PARENT_REF]);
    expect(session?.config.app.ui).toMatchObject({
      production: "https://ui.child.dev",
      development: "local:ui",
    });
    expect(session?.config.app.host).toEqual(remoteChainParent.app?.host);
    expect(session?.config.account).toBe("child.near");
    expect(session?.rawConfig).toEqual(remoteChainChild);
    expect(session?.runtime?.ui.url).toBe("https://ui.child.dev");
  });

  it("throws a tagged CircularExtendsError carrying the full chain for a circular local extends", async () => {
    const files = {
      "/chain/a/bos.config.json": JSON.stringify({
        extends: "/chain/b/bos.config.json",
        account: "a.near",
      }),
      "/chain/b/bos.config.json": JSON.stringify({
        extends: "/chain/a/bos.config.json",
        account: "b.near",
      }),
    };

    const error = await openedOrError(
      openResolution({ path: "/chain/a/bos.config.json" }, memoryIo(files, {})),
    );

    expect(error).toBeInstanceOf(CircularExtendsError);
    expect((error as CircularExtendsError).chain).toEqual([
      "/chain/a/bos.config.json",
      "/chain/b/bos.config.json",
      "/chain/a/bos.config.json",
    ]);
  });

  it("throws ConfigLoadError for a missing local config file", async () => {
    const error = await openedOrError(
      openResolution({ path: "/elsewhere/bos.config.json" }, memoryIo({}, {})),
    );

    expect(error).toBeInstanceOf(ConfigLoadError);
    expect((error as ConfigLoadError).path).toBe("/elsewhere/bos.config.json");
  });

  it("returns null when a remote config is not found", async () => {
    const session = await openResolution(
      { account: "missing.near", gateway: "missing.dev" },
      memoryIo({}, {}),
    );

    expect(session).toBeNull();
  });

  it("maps the staging env onto production for the built runtime", async () => {
    const path = "/stage/bos.config.json";
    const hostEntry = "remoteEntry.stage-host.js";
    const hostManifest = {
      version: "8f3ac1d2feedbeef",
      builtAt: "2026-09-30T12:00:00.000Z",
      entry: hostEntry,
      entryIntegrity: "sha384-entry",
    };
    const config: BosConfigInput = {
      ...devOnlyConfig,
      app: {
        ...devOnlyConfig.app,
        host: {
          development: "local:host",
          production: "https://stage.test/host",
          pin: {
            manifest: `versions/${hostEntry}.json`,
            integrity: `sha384-${await createHash("sha384").update(JSON.stringify(hostManifest)).digest("base64")}`,
          },
        },
      },
    };
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input) === `https://stage.test/host/versions/${hostEntry}.json`) {
        return new Response(JSON.stringify(hostManifest), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });

    const session = await openResolution(
      { path, env: "staging" },
      memoryIo({ [path]: JSON.stringify(config) }, {}),
    );

    expect(session).not.toBeNull();
    expect(session?.runtime?.env).toBe("production");
  });
});

describe("openResolution × dev overlay (bos.dev.ts)", () => {
  const overlayParent: BosConfigInput = {
    account: "parent.near",
    app: {
      api: { development: "local:api-parent", variables: { SLOT: "parent" } },
    },
  };

  const overlayLeaf: BosConfigInput = {
    extends: "/parent/bos.config.json",
    account: "local.near",
    app: {
      host: { development: "local:host", production: "" },
      ui: { development: "local:ui" },
      api: { development: "local:api", variables: { SLOT: "leaf" } },
    },
  };

  const overlayModule = {
    default: { api: { path: "api-dev", variables: { SLOT: "overlay" } } },
  };

  const chainFiles = (extra: Record<string, string> = {}): Record<string, string> => ({
    "/project/bos.config.json": JSON.stringify(overlayLeaf),
    "/parent/bos.config.json": JSON.stringify(overlayParent),
    ...extra,
  });

  const overlayIo = (
    files: Record<string, string>,
    modules: Record<string, Record<string, unknown>>,
  ): ResolutionIo => ({
    ...memoryIo(files, {}),
    importModule: async (path) => {
      const mod = modules[path];
      if (!mod) throw new Error(`no module fixture registered for ${path}`);
      return mod;
    },
  });

  it("merges the overlay child-wins over the leaf, which wins over the parent chain, in development", async () => {
    const session = await openResolution(
      { path: "/project/bos.config.json", env: "development" },
      overlayIo(chainFiles({ "/project/bos.dev.ts": "export default {}" }), {
        "/project/bos.dev.ts": overlayModule,
      }),
    );

    expect(session?.config.app.api).toMatchObject({
      development: "local:api-dev",
      variables: { SLOT: "overlay" },
    });
    expect(session?.config.app.host).toMatchObject({ development: "local:host" });
    expect(session?.chain).toEqual(["/project/bos.config.json", "/parent/bos.config.json"]);
  });

  it("golden: without a bos.dev.ts the resolution is unchanged and no module import happens", async () => {
    const session = await openResolution(
      { path: "/project/bos.config.json", env: "development" },
      overlayIo(chainFiles(), {}),
    );

    expect(session?.config.app.api).toEqual({
      development: "local:api",
      variables: { SLOT: "leaf" },
    });
    expect(session?.rawConfig).toEqual(overlayLeaf);
  });

  it("golden: a present bos.dev.ts defaulting to {} resolves identically to the no-overlay open", async () => {
    const withEmptyOverlay = await openResolution(
      { path: "/project/bos.config.json", env: "development" },
      overlayIo(chainFiles({ "/project/bos.dev.ts": "export default {}" }), {
        "/project/bos.dev.ts": { default: {} },
      }),
    );
    const withoutOverlay = await openResolution(
      { path: "/project/bos.config.json", env: "development" },
      overlayIo(chainFiles(), {}),
    );

    expect(JSON.stringify(withEmptyOverlay?.config)).toBe(JSON.stringify(withoutOverlay?.config));
    expect(withEmptyOverlay?.rawConfig).toEqual(withoutOverlay?.rawConfig);
  });

  it("never reads the overlay in production or staging", async () => {
    const hostEntry = "remoteEntry.overlay-host.js";
    const hostManifest = {
      version: "8f3ac1d2feedbeef",
      builtAt: "2026-09-30T12:00:00.000Z",
      entry: hostEntry,
      entryIntegrity: "sha384-entry",
    };
    const pinnedLeaf: BosConfigInput = {
      ...overlayLeaf,
      app: {
        ...overlayLeaf.app,
        host: {
          development: "local:host",
          production: "https://stage.test/host",
          pin: {
            manifest: `versions/${hostEntry}.json`,
            integrity: `sha384-${createHash("sha384").update(JSON.stringify(hostManifest)).digest("base64")}`,
          },
        },
      },
    };
    vi.stubGlobal("fetch", async (input: string | URL) => {
      if (String(input) === `https://stage.test/host/versions/${hostEntry}.json`) {
        return new Response(JSON.stringify(hostManifest), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });

    for (const env of ["production", "staging"] as const) {
      const session = await openResolution(
        { path: "/project/bos.config.json", env },
        overlayIo(
          {
            "/project/bos.config.json": JSON.stringify(pinnedLeaf),
            "/parent/bos.config.json": JSON.stringify(overlayParent),
            "/project/bos.dev.ts": "export default {}",
          },
          { "/project/bos.dev.ts": overlayModule },
        ),
      );

      expect(session?.config.app.api?.variables).toEqual({ SLOT: "leaf" });
    }
  });

  it("throws a loud DevOverlayError naming the file for a malformed overlay", async () => {
    const error = await openedOrError(
      openResolution(
        { path: "/project/bos.config.json", env: "development" },
        overlayIo(chainFiles({ "/project/bos.dev.ts": "export default 42" }), {
          "/project/bos.dev.ts": { default: 42 },
        }),
      ),
    );

    expect(error).toBeInstanceOf(DevOverlayError);
    expect((error as DevOverlayError).message).toContain("/project/bos.dev.ts");
  });

  it("throws a DevOverlayError when the overlay module has no default export", async () => {
    const error = await openedOrError(
      openResolution(
        { path: "/project/bos.config.json", env: "development" },
        overlayIo(chainFiles({ "/project/bos.dev.ts": "export const overlay = {}" }), {
          "/project/bos.dev.ts": { overlay: {} },
        }),
      ),
    );

    expect(error).toBeInstanceOf(DevOverlayError);
    expect((error as DevOverlayError).path).toBe("/project/bos.dev.ts");
  });
});

describe("ResolutionSession.fromParts", () => {
  it("carries fixture parts with zero io and drains warnings on read", () => {
    const session = ResolutionSession.fromParts({
      config: devOnlyConfig as never,
      runtime: null as never,
      root: "/fixture-root",
      source: {
        path: "/fixture-root/bos.config.json",
        extended: ["first", "second"],
        remote: false,
      },
      warnings: ["w1", "w2"],
    });

    expect(session.root).toBe("/fixture-root");
    expect(session.path).toBe("/fixture-root/bos.config.json");
    expect(session.chain).toEqual(["first", "second"]);
    expect(session.rawConfig).toBeNull();
    expect(session.catalog).toBeNull();
    expect(session.warnings).toEqual(["w1", "w2"]);
    expect(session.warnings).toEqual([]);
  });
});

describe("walkExtendsChain (catalog mode)", () => {
  const parentCatalogConfig: BosConfigInput = {
    account: "parent.near",
    domain: "parent.dev",
    app: {
      host: { development: "local:host", production: "" },
      ui: { development: "local:ui", production: "https://ui.parent.dev" },
      api: { development: "local:api" },
    },
  };

  beforeEach(() => {
    catalogMocks.cleanups.length = 0;
    catalogMocks.configs.clear();
    catalogMocks.sourceDirs.clear();
    catalogMocks.configs.set(CHILD_REF, remoteChainChild);
    catalogMocks.configs.set(PARENT_REF, parentCatalogConfig);
    catalogMocks.sourceDirs.set(CHILD_REF, "/virtual/child.near/child.dev");
    catalogMocks.sourceDirs.set(PARENT_REF, "/virtual/parent.near/parent.dev");
  });

  it("accumulates post-order visits and runs registered cleanups in reverse", async () => {
    const links: WalkLink[] = [];
    const { chain, config } = await walkExtendsChain(CHILD_REF, {
      env: "production",
      collectCatalogs: true,
      visit: async (link) => {
        links.push(link);
      },
    });

    expect(chain).toEqual([CHILD_REF, PARENT_REF]);
    expect(
      (config.app as Record<string, Record<string, unknown>> | undefined)?.ui?.production,
    ).toBe("https://ui.child.dev");
    expect(links.map((link) => link.ref)).toEqual([PARENT_REF, CHILD_REF]);
    expect(links.map((link) => link.isLeaf)).toEqual([true, false]);
    expect(links[0]?.sourceDir).toBe("/virtual/parent.near/parent.dev");
    expect(catalogMocks.cleanups).toEqual(["bos://parent.near/parent.dev", CHILD_REF]);
  });

  it("still runs the reverse-order cleanups when the visit throws", async () => {
    await expect(
      walkExtendsChain(CHILD_REF, {
        env: "production",
        collectCatalogs: true,
        visit: async () => {
          throw new Error("visit blew up");
        },
      }),
    ).rejects.toThrow("visit blew up");

    expect(catalogMocks.cleanups).toEqual(["bos://parent.near/parent.dev", CHILD_REF]);
  });
});

describe("CircularExtendsError uniformity across walkers", () => {
  it("throws the same tagged error with a full chain payload for local file chains and remote bos:// chains", async () => {
    const localFiles = {
      "/chain/a/bos.config.json": JSON.stringify({
        extends: "/chain/b/bos.config.json",
        account: "a.near",
      }),
      "/chain/b/bos.config.json": JSON.stringify({
        extends: "/chain/a/bos.config.json",
        account: "b.near",
      }),
    };
    const remoteConfigs = {
      "bos://a.near/a.dev": { extends: "bos://b.near/b.dev", account: "a.near" },
      "bos://b.near/b.dev": { extends: "bos://a.near/a.dev", account: "b.near" },
    };

    const localError = (await openedOrError(
      walkExtendsChain("/chain/a/bos.config.json", {
        io: memoryIo(localFiles, {}),
        visit: async () => {},
      }),
    )) as CircularExtendsError;
    const remoteError = (await openedOrError(
      walkExtendsChain("bos://a.near/a.dev", {
        io: memoryIo({}, remoteConfigs),
        visit: async () => {},
      }),
    )) as CircularExtendsError;

    expect(localError).toBeInstanceOf(CircularExtendsError);
    expect(remoteError).toBeInstanceOf(CircularExtendsError);
    expect(localError.chain).toEqual([
      "/chain/a/bos.config.json",
      "/chain/b/bos.config.json",
      "/chain/a/bos.config.json",
    ]);
    expect(remoteError.chain).toEqual([
      "bos://a.near/a.dev",
      "bos://b.near/b.dev",
      "bos://a.near/a.dev",
    ]);
  });
});
