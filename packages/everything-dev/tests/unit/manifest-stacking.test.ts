import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiPluginManifest } from "../../src/api-contract";
import { buildDependencyDAG } from "../../src/dag";

const { fetchApiPluginManifestMock } = vi.hoisted(() => ({
  fetchApiPluginManifestMock: vi.fn(),
}));

vi.mock("../../src/api-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api-contract")>();
  return {
    ...actual,
    fetchApiPluginManifest: fetchApiPluginManifestMock,
  };
});

const MANIFEST: ApiPluginManifest = {
  schemaVersion: 1,
  kind: "every-plugin/manifest",
  plugin: { name: "api", version: "1.0.0" },
  runtime: { remoteEntry: "http://api.cdn/remoteEntry.js" },
  plugins: [
    {
      key: "discovered",
      name: "Discovered Plugin",
      url: "http://discovered.cdn",
      dependsOn: ["auth"],
      secrets: ["STRIPE_KEY"],
      variables: { TIMEOUT: 5000 },
    },
    {
      key: "pluginA",
      name: "PluginA Override Attempt",
      url: "http://evil.cdn",
    },
  ],
  dependsOn: ["pluginA", "auth"],
};

function makeRemoteBosConfig() {
  return {
    account: "test.near",
    extends: "dev.everything.near/dev.everything.dev",
    app: {
      host: { name: "host", development: "http://localhost:3000", production: "http://host.cdn" },
      ui: { name: "ui", development: "http://localhost:3003", production: "http://ui.cdn" },
      api: { name: "api", development: "http://localhost:3001", production: "http://api.cdn" },
      auth: {
        name: "auth",
        extends: "dev.everything.near/auth",
        development: "http://localhost:3002",
        production: "http://auth.cdn",
      },
    },
    plugins: {
      pluginA: {
        name: "pluginA",
        url: "http://pluginA.cdn",
        source: "remote" as const,
      },
    },
  } as any;
}

describe("manifest stacking (one level deep)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchApiPluginManifestMock.mockClear();
    fetchApiPluginManifestMock.mockResolvedValue(MANIFEST);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("discovers manifest plugins, merges secrets/variables, respects config-over-manifest, and builds correct DAG", async () => {
    const { buildRuntimeConfig } = await import("../../src/config");

    const result = await buildRuntimeConfig(makeRemoteBosConfig(), "/tmp", "production", {
      hostSource: "remote",
      uiSource: "remote",
      apiSource: "remote",
      authSource: "remote",
      plugins: {
        pluginA: {
          name: "pluginA",
          url: "http://pluginA.cdn",
          entry: "http://pluginA.cdn/mf-manifest.json",
          source: "remote",
        },
      },
    });

    expect(result.plugins?.discovered).toBeDefined();
    expect(result.plugins?.discovered.url).toBe("http://discovered.cdn");
    expect(result.plugins?.discovered.source).toBe("remote");
    expect(result.plugins?.discovered.secrets).toEqual(["STRIPE_KEY"]);
    expect(result.plugins?.discovered.variables).toEqual({ TIMEOUT: 5000 });

    expect(result.plugins?.pluginA.url).toBe("http://pluginA.cdn");

    expect(result.nodes?.discovered).toBeDefined();
    expect(result.nodes?.discovered.sourceOrigin).toBe("manifest");
    expect(result.nodes?.discovered.kind).toBe("plugin");

    expect(result.nodes?.pluginA.sourceOrigin).toBe("config");

    expect(result.api.dependsOn).toEqual(expect.arrayContaining(["pluginA", "auth"]));

    const dag = buildDependencyDAG(result);
    expect(dag.sorted).toContain("discovered");
    expect(dag.sorted.indexOf("auth")).toBeLessThan(dag.sorted.indexOf("discovered"));
    expect(dag.nodes.get("discovered")?.sourceOrigin).toBe("manifest");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Plugin "discovered"'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("STRIPE_KEY"));
  });

  it("allows config-declared plugin to override manifest-discovered plugin with custom variables", async () => {
    const { buildRuntimeConfig } = await import("../../src/config");

    const result = await buildRuntimeConfig(makeRemoteBosConfig(), "/tmp", "production", {
      hostSource: "remote",
      uiSource: "remote",
      apiSource: "remote",
      authSource: "remote",
      plugins: {
        discovered: {
          name: "discovered",
          url: "http://my-discovered.cdn",
          entry: "http://my-discovered.cdn/mf-manifest.json",
          source: "remote",
          variables: { TIMEOUT: 10000 },
          secrets: ["MY_SECRET"],
        },
      },
    });

    expect(result.plugins?.discovered.url).toBe("http://my-discovered.cdn");
    expect(result.plugins?.discovered.variables).toEqual({ TIMEOUT: 10000 });
    expect(result.nodes?.discovered.sourceOrigin).toBe("config");
  });

  it("gracefully degrades when manifest fetch fails", async () => {
    const { buildRuntimeConfig } = await import("../../src/config");

    fetchApiPluginManifestMock.mockRejectedValue(new Error("Network error"));

    const result = await buildRuntimeConfig(makeRemoteBosConfig(), "/tmp", "production", {
      hostSource: "remote",
      uiSource: "remote",
      apiSource: "remote",
      authSource: "remote",
    });

    expect(result.plugins?.discovered).toBeUndefined();
    expect(result.nodes).toBeDefined();
    expect(result.nodes?.api).toBeDefined();
    expect(result.nodes?.api.sourceOrigin).toBe("config");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch API plugin manifest"),
    );
  });

  it("does not fetch manifest for local API", async () => {
    const { buildRuntimeConfig } = await import("../../src/config");
    const { mkdtempSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const testDir = mkdtempSync(join(tmpdir(), "manifest-stack-local-"));
    mkdirSync(join(testDir, "api"), { recursive: true });

    const result = await buildRuntimeConfig(
      {
        account: "test.near",
        extends: "dev.everything.near/dev.everything.dev",
        app: {
          host: {
            name: "host",
            development: "http://localhost:3000",
            production: "http://host.cdn",
          },
          ui: { name: "ui", development: "http://localhost:3003", production: "http://ui.cdn" },
          api: { name: "api", development: "local:api", production: "http://api.cdn" },
        },
      } as any,
      testDir,
      "development",
      { apiSource: "local" },
    );

    expect(result.api.source).toBe("local");
    expect(fetchApiPluginManifestMock).not.toHaveBeenCalled();
    expect(result.plugins?.discovered).toBeUndefined();
    expect(result.nodes?.discovered).toBeUndefined();

    const { rmSync } = await import("node:fs");
    rmSync(testDir, { recursive: true, force: true });
  });
});
