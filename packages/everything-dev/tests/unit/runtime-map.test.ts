import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "every-plugin/ui/manifest";
import { constructTree } from "every-plugin/ui/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeRuntimeMap,
  generateRuntimeMapEffect,
  type MapSource,
} from "../../src/services/codegen/runtime-map";
import type { RuntimeConfig } from "../../src/types";

function source(
  key: string,
  routes: Array<Record<string, unknown>>,
  overrides?: Partial<MapSource>,
): MapSource & { manifest: PluginManifest } {
  return {
    key,
    kind: key === "ui" ? "core" : "plugin-ui",
    source: "local",
    location: key,
    manifest: { manifestVersion: 2, routes } as PluginManifest,
    ...overrides,
  };
}

describe("composeRuntimeMap — the static model of constructTree (#594)", () => {
  it("composes mount-level and nested plugin routes with full paths", () => {
    const map = composeRuntimeMap([
      source("ui", [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/index", type: "route", path: "/", parent: "_public" },
      ]),
      source("votes", [
        { id: "_authenticated", type: "layout", mount: "authenticated" },
        {
          id: "_authenticated/vote-feed",
          type: "route",
          path: "/votes",
          parentId: "_authenticated",
        },
      ]),
    ]);
    expect(map.mounts).toEqual([
      { id: "public", declaredBy: "ui", recordId: "_public" },
      { id: "authenticated", declaredBy: "votes", recordId: "_authenticated" },
    ]);
    const votes = map.routes.find((route) => route.owner === "votes");
    expect(votes?.fullPath).toBe("/votes");
  });

  it("core ui shadows a plugin's mount and route claims — reported, not composed", () => {
    const map = composeRuntimeMap([
      source("ui", [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/login", type: "route", path: "/login" },
      ]),
      source("auth", [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/login", type: "route", path: "/login" },
      ]),
    ]);
    expect(map.shadowed).toHaveLength(2);
    expect(map.shadowed.map((entry) => entry.owner)).toEqual(["auth", "auth"]);
    // only the core's routes compose
    expect(map.routes.every((route) => route.core)).toBe(true);
  });

  it("a peer path collision throws", () => {
    expect(() =>
      composeRuntimeMap([
        source("ui", [{ id: "_public", type: "layout", mount: "public" }]),
        source("votes", [{ id: "_public/x", type: "route", path: "/x" }]),
        source("proposals", [{ id: "_public/x", type: "route", path: "/x" }]),
      ]),
    ).toThrow(/path collision/);
  });

  it("a route outside any mount throws", () => {
    expect(() =>
      composeRuntimeMap([source("votes", [{ id: "orphan", type: "route", path: "/x" }])]),
    ).toThrow(/must live under a mount/);
  });
});

describe("engine parity — composeRuntimeMap matches the real constructTree", () => {
  // The static model must agree with the composition engine it models. If
  // the engine's precedence evolves, this test forces the model to follow —
  // instead of silently generating wrong maps (the child's
  // verify-runtime-map, institutionalized).
  const joinPath = (a: string, b: string): string => {
    const left = a && a !== "/" ? a.replace(/\/+$/, "") : "";
    const right = b && b !== "/" ? b.replace(/^\/+/, "") : "";
    if (!left) return right ? `/${right}` : "/";
    if (!right) return left;
    return `${left}/${right}`;
  };

  const fixtures: Record<string, PluginManifest> = {
    ui: {
      manifestVersion: 2,
      routes: [
        { id: "_public", type: "layout", mount: "public" },
        { id: "_public/index", type: "route", path: "/" },
        { id: "_public/login", type: "route", path: "/login" },
        { id: "_authenticated", type: "layout", mount: "authenticated" },
        { id: "_authenticated/dashboard", type: "route", path: "/dashboard" },
        {
          id: "_authenticated/settings",
          type: "route",
          path: "/settings",
          parentId: "_authenticated",
        },
        {
          id: "_authenticated/settings/keys",
          type: "route",
          path: "/api-keys",
          parentId: "_authenticated/settings",
        },
      ],
    } as PluginManifest,
    votes: {
      manifestVersion: 2,
      routes: [
        { id: "_authenticated", type: "layout", mount: "authenticated" },
        {
          id: "_authenticated/votes",
          type: "route",
          path: "/votes",
          parentId: "_authenticated",
        },
      ],
    } as PluginManifest,
    proposals: {
      manifestVersion: 2,
      routes: [
        // core wins this claim — shadowed
        { id: "_authenticated", type: "layout", mount: "authenticated" },
        {
          id: "_authenticated/proposals",
          type: "route",
          path: "/proposals",
          parentId: "_authenticated",
        },
      ],
    } as PluginManifest,
  };

  const loaders = (manifest: PluginManifest) =>
    Object.fromEntries(manifest.routes.map((route) => [route.id, async () => ({})]));

  it("the composed full-path set is exactly the engine's", async () => {
    const sources = ["ui", "votes", "proposals"].map((key) => ({
      key,
      kind: key === "ui" ? ("core" as const) : ("plugin-ui" as const),
      source: "local" as const,
      location: key,
      manifest: fixtures[key]!,
    }));
    const map = composeRuntimeMap(sources);
    const mapped = new Set(map.routes.map((route) => route.fullPath));

    const tree = await constructTree({
      name: "parity",
      plugins: sources.map((s) => ({ key: s.key, mfName: s.key })),
      resolve: async (ref) => {
        const manifest = fixtures[ref.key]!;
        return { key: ref.key, manifest, routeConfig: { routeConfigLoaders: loaders(manifest) } };
      },
    });

    const paths = new Set<string>();
    const walk = (route: never, parentPath: string): void => {
      const segment = (route as { options?: { path?: string } }).options?.path;
      const fullPath = segment === undefined ? parentPath : joinPath(parentPath, segment);
      if (segment !== undefined) paths.add(fullPath);
      for (const child of (route as { children?: never[] }).children ?? []) {
        walk(child, fullPath);
      }
    };
    walk(tree.routeTree, "");

    const missing = [...paths].filter((path) => !mapped.has(path));
    const extra = [...mapped].filter((path) => !paths.has(path));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
    // and the shadow accounting agrees: proposals' shadowed login-class claim
    expect(map.shadowed.some((entry) => entry.owner === "proposals")).toBe(true);
  });
});

describe("generateRuntimeMapEffect — backend inventory (#594 review)", () => {
  let tempDir: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const routeManifest: PluginManifest = {
    manifestVersion: 2,
    routes: [{ id: "_public", type: "layout", mount: "public" }],
  } as PluginManifest;

  const pluginManifestAsset = (version: string, sha: string) => ({
    schemaVersion: 1,
    kind: "every-plugin/manifest",
    plugin: { name: "x", version },
    runtime: { remoteEntry: "./remoteEntry.js" },
    contract: { kind: "orpc", types: { sha256: sha } },
  });

  function fixtureRuntime(): RuntimeConfig {
    tempDir = mkdtempSync(join(tmpdir(), "runtime-map-backends-"));
    mkdirSync(join(tempDir, "ui", "src", "lib"), { recursive: true });
    mkdirSync(join(tempDir, "plugins", "votes", "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "plugins", "votes", "src", "manifest.gen.json"),
      JSON.stringify(routeManifest),
    );
    return {
      env: "development",
      account: "child.near",
      networkId: "mainnet",
      host: {
        name: "host",
        url: "http://localhost:3000",
        entry: "/mf-manifest.json",
        source: "local",
        localPath: join(tempDir, "host"),
      },
      ui: {
        name: "ui",
        url: "http://localhost:3003",
        entry: "/mf-manifest.json",
        source: "local",
        localPath: join(tempDir, "ui"),
      },
      api: {
        name: "api",
        url: "https://cdn.example.test/api/",
        entry: "/mf-manifest.json",
        source: "remote",
      },
      auth: {
        name: "@everything-dev/auth-plugin",
        url: "https://cdn.example.test/auth/",
        entry: "/mf-manifest.json",
        source: "remote",
      },
      plugins: {
        votes: {
          name: "votes",
          url: "http://localhost:3110",
          entry: "/mf-manifest.json",
          source: "local",
          localPath: join(tempDir, "plugins", "votes"),
        },
      },
    } as RuntimeConfig;
  }

  it("inventories host + api + auth + plugins; remote backends carry version + contract sha", async () => {
    const runtime = fixtureRuntime();
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      const href = url.toString();
      if (href === "https://cdn.example.test/api/plugin.manifest.json") {
        return { ok: true, json: async () => pluginManifestAsset("2.0.0-rc.9", "sha256-api") };
      }
      if (href === "https://cdn.example.test/auth/plugin.manifest.json") {
        return { ok: true, json: async () => pluginManifestAsset("2.0.0-rc.8", "sha256-auth") };
      }
      throw new Error(`unexpected fetch ${href}`);
    }) as typeof fetch);

    const result = await vi.importActual<typeof import("effect")>("effect").then(({ Effect }) =>
      Effect.runPromise(
        generateRuntimeMapEffect(tempDir, runtime, {
          env: "development",
          platform: "2.0.0-rc.21",
          extendsChain: ["bos://dev.everything.near/everything.dev"],
        }),
      ),
    );

    expect(result).not.toBeNull();
    expect(result!.backendCount).toBe(4);
    const map = JSON.parse(readFileSync(join(tempDir, ".bos/generated/runtime-map.json"), "utf8"));
    expect(map.platform).toBe("2.0.0-rc.21");
    expect(map.extends).toBe("bos://dev.everything.near/everything.dev");
    const byKey = Object.fromEntries(map.backends.map((b: { key: string }) => [b.key, b]));
    expect(byKey.host).toMatchObject({ kind: "host", source: "local" });
    expect(byKey.api).toMatchObject({
      source: "remote",
      pluginVersion: "2.0.0-rc.9",
      contractSha256: "sha256-api",
    });
    expect(byKey.auth).toMatchObject({
      source: "remote",
      pluginVersion: "2.0.0-rc.8",
      contractSha256: "sha256-auth",
    });
    expect(byKey.votes).toMatchObject({ kind: "plugin", source: "local" });
    // the TS surface carries the backends
    const ts = readFileSync(join(tempDir, "ui/src/lib/runtime-map.gen.ts"), "utf8");
    expect(ts).toContain("RUNTIME_BACKENDS");
  });

  it("a remote plugin manifest that fails to fetch degrades loudly, not silently", async () => {
    const runtime = fixtureRuntime();
    runtime.api!.url = "https://broken.example.test/api/";
    vi.stubGlobal("fetch", (async () => {
      throw new Error("registry unreachable");
    }) as typeof fetch);

    const { Effect } = await vi.importActual<typeof import("effect")>("effect");
    const result = await Effect.runPromise(
      generateRuntimeMapEffect(tempDir, runtime, { env: "development" }),
    );

    expect(result?.unresolved.map((entry) => entry.key)).toContain("api");
    const map = JSON.parse(readFileSync(join(tempDir, ".bos/generated/runtime-map.json"), "utf8"));
    const apiBackend = map.backends.find((b: { key: string }) => b.key === "api");
    expect(apiBackend.note).toContain("registry unreachable");
    // the other backends still inventory
    expect(map.backends).toHaveLength(4);
  });
});
