import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { PluginManifest } from "every-plugin/ui/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactGenError,
  generateCodeArtifactsEffect,
  uiManifestTargets,
} from "../../src/services/codegen/artifacts";
import type { RuntimeConfig } from "../../src/types";

// The regression start jobs run strict types gen on a fresh checkout:
// folder-form plugin uis (no committed rsbuild.config.ts) had no
// manifest.gen.json until a dev/build compile generated one, so the strict
// runtime map reported the plugin-ui UNRESOLVED and failed the run on a
// source typegen itself should have generated (#612 follow-up).

const CDN = "https://cdn.example.test";

const coreUiManifest: PluginManifest = {
  manifestVersion: 2,
  routes: [
    { id: "_public", type: "layout", mount: "public" },
    { id: "_public/login", type: "route", path: "/login" },
    { id: "_authenticated", type: "layout", mount: "authenticated" },
  ],
} as PluginManifest;

const pluginManifestAsset = (version: string, sha: string) => ({
  schemaVersion: 1,
  kind: "every-plugin/manifest",
  plugin: { name: "x", version },
  runtime: { remoteEntry: "./remoteEntry.js" },
  contract: { kind: "orpc", types: { sha256: sha } },
});

function writePluginUiRoutes(uiDir: string): void {
  mkdirSync(join(uiDir, "src", "routes"), { recursive: true });
  writeFileSync(
    join(uiDir, "src", "routes", "__root.tsx"),
    "import { createRootRoute, Outlet } from '@tanstack/react-router';\nexport const Route = createRootRoute({ component: Outlet });\n",
  );
  writeFileSync(
    join(uiDir, "src", "routes", "_authenticated.chat.tsx"),
    "import { createFileRoute } from '@tanstack/react-router';\nexport const Route = createFileRoute('/_authenticated/chat')({});\n",
  );
}

function fixtureRuntime(tempDir: string, opts?: { withPluginUiRoutes?: boolean }): RuntimeConfig {
  const uiDir = join(tempDir, "plugins", "ai", "ui");
  if (opts?.withPluginUiRoutes !== false) {
    writePluginUiRoutes(uiDir);
  }
  mkdirSync(join(tempDir, "api", "src"), { recursive: true });
  writeFileSync(join(tempDir, "api", "src", "contract.ts"), "export {};\n");
  return {
    env: "development",
    account: "child.near",
    networkId: "mainnet",
    host: {
      name: "host",
      url: `${CDN}/host/`,
      entry: "/mf-manifest.json",
      source: "remote",
    },
    ui: {
      name: "ui",
      url: `${CDN}/ui/`,
      entry: "/mf-manifest.json",
      source: "remote",
    },
    api: {
      name: "api",
      entry: "/mf-manifest.json",
      source: "local",
      localPath: join(tempDir, "api"),
    },
    auth: {
      name: "@everything-dev/auth-plugin",
      url: `${CDN}/auth/`,
      entry: "/mf-manifest.json",
      source: "remote",
    },
    plugins: {
      ai: {
        name: "ai",
        source: "local",
        localPath: join(tempDir, "plugins", "ai"),
        ui: {
          name: "ai-ui",
          source: "local",
          localPath: uiDir,
        },
      },
    },
  } as unknown as RuntimeConfig;
}

function stubCdn(): void {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    const href = url.toString();
    if (href === `${CDN}/ui/manifest.gen.json`) {
      return { ok: true, json: async () => coreUiManifest };
    }
    if (href === `${CDN}/host/plugin.manifest.json`) {
      return { ok: true, json: async () => pluginManifestAsset("2.0.0-rc.21", "sha256-host") };
    }
    if (href === `${CDN}/auth/plugin.manifest.json`) {
      return { ok: true, json: async () => pluginManifestAsset("2.0.0-rc.8", "sha256-auth") };
    }
    throw new Error(`unexpected fetch ${href}`);
  }) as typeof fetch);
}

describe("uiManifestTargets — the plugin-ui manifest gate", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("a folder-form plugin ui (src/routes, no rsbuild.config.ts) is a manifest target", () => {
    tempDir = mkdtempSync(join(tmpdir(), "manifest-gate-"));
    const uiDir = join(tempDir, "plugins", "ai", "ui");
    writePluginUiRoutes(uiDir);
    const runtime = fixtureRuntime(tempDir);
    const targets = uiManifestTargets(runtime);
    expect(targets.some((t) => t.pluginName === "ai" && t.workspaceRoot === uiDir)).toBe(true);
  });

  it("a ui slot without src/routes is not a manifest target", () => {
    tempDir = mkdtempSync(join(tmpdir(), "manifest-gate-"));
    mkdirSync(join(tempDir, "plugins", "ai", "ui", "src"), { recursive: true });
    const runtime = fixtureRuntime(tempDir, { withPluginUiRoutes: false });
    const targets = uiManifestTargets(runtime);
    expect(targets.some((t) => t.pluginName === "ai")).toBe(false);
  });
});

describe("generateCodeArtifactsEffect — strict types gen on a fresh checkout", () => {
  let tempDir: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("generates a folder-form plugin ui's manifest and a complete map (pre-fix: failed UNRESOLVED)", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "artifact-gen-fresh-"));
    const runtime = fixtureRuntime(tempDir);
    stubCdn();

    const result = await Effect.runPromise(
      generateCodeArtifactsEffect(tempDir, { platform: null } as never, {
        runtimeConfig: runtime,
        runtimeMapStrict: true,
      }),
    );

    expect(result).not.toBeNull();
    const manifestPath = join(tempDir, "plugins", "ai", "ui", "src", "manifest.gen.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expect(manifest.name).toBe("ai");
    expect(manifest.routes.map((r: { id: string }) => r.id)).toContain("_authenticated/chat");

    const map = JSON.parse(readFileSync(join(tempDir, ".bos/generated/runtime-map.json"), "utf8"));
    expect(map.unresolved).toEqual([]);
    expect(map.routes.some((route: { owner: string }) => route.owner === "ai")).toBe(true);
  });
});

describe("ArtifactGenError — the wire message is never empty", () => {
  let tempDir: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("renders phase + cause when no message field exists", () => {
    const error = new ArtifactGenError({
      phase: "generate runtime map",
      cause: new Error("runtime map is incomplete — ai (plugin-ui): local path is absent"),
    });
    expect(error.message).toBe(
      "artifact generation failed (generate runtime map): runtime map is incomplete — ai (plugin-ui): local path is absent",
    );
  });

  it("renders non-Error causes and omits the colon when there is no cause", () => {
    expect(new ArtifactGenError({ phase: "write resolved config", cause: "boom" }).message).toBe(
      "artifact generation failed (write resolved config): boom",
    );
    expect(new ArtifactGenError({ phase: "generate runtime map" }).message).toBe(
      "artifact generation failed (generate runtime map)",
    );
  });

  it("a rejected strict run carries the formatted message, not ''", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "artifact-gen-error-"));
    const runtime = fixtureRuntime(tempDir, { withPluginUiRoutes: false });
    stubCdn();

    const error = await Effect.runPromise(
      generateCodeArtifactsEffect(tempDir, { platform: null } as never, {
        runtimeConfig: runtime,
        runtimeMapStrict: true,
      }),
    ).catch((e) => e);

    expect(error).toBeInstanceOf(ArtifactGenError);
    expect(error.message).not.toBe("");
    expect(error.message).toContain("artifact generation failed (generate runtime map)");
    expect(error.message).toContain("ai (plugin-ui)");
  });
});
