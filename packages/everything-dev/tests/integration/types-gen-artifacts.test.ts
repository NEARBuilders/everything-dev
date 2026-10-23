import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getResolvedConfigPath } from "../../src/config";
import { generateCodeArtifacts } from "../../src/services/codegen/artifacts";
import type { BosConfig, RuntimeConfig } from "../../src/types";

vi.mock("../../src/services/codegen/api-contract", () => ({
  syncApiContractBridge: async () => ({ bridgePath: ".bos/api-types.gen.ts", status: [] }),
}));

const fixtureSrc = join(import.meta.dirname, "../fixtures/ui/basic/src");

const CONFIG = {
  account: "test.near",
  domain: "test.dev",
  app: {
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "./src/program.ts",
      source: "local",
    },
    ui: { name: "ui", url: "http://localhost:3003", entry: "./src/entry.tsx", source: "local" },
    api: { name: "api", url: "http://localhost:3001", entry: "./src/index.ts", source: "local" },
  },
} as unknown as BosConfig;

function buildRuntimeConfig(uiLocalPath: string): RuntimeConfig {
  return {
    env: "development",
    account: "test.near",
    networkId: "testnet",
    host: {
      name: "host",
      url: "http://localhost:3000",
      entry: "./src/program.ts",
      source: "local",
    },
    ui: {
      name: "ui",
      url: "http://localhost:3003",
      entry: "./src/entry.tsx",
      source: "local",
      localPath: uiLocalPath,
    },
    api: { name: "api", url: "http://localhost:3001", entry: "./src/index.ts", source: "local" },
  } as unknown as RuntimeConfig;
}

describe("generateCodeArtifacts (types-gen hermetic resolution — #536)", () => {
  let projectDir: string;
  let uiDir: string;

  function routeTree(): string {
    return readFileSync(join(uiDir, "src/routeTree.gen.ts"), "utf-8");
  }

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "bos-types-gen-"));
    uiDir = join(projectDir, "ui");
    writeFileSync(join(projectDir, "bos.config.json"), JSON.stringify(CONFIG));
    cpSync(fixtureSrc, join(uiDir, "src"), { recursive: true });
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes the resolved config with env metadata when env is passed", async () => {
    const result = await generateCodeArtifacts(projectDir, CONFIG, {
      env: "development",
      extendsChain: ["bos://parent.near/app"],
      runtimeConfig: buildRuntimeConfig(uiDir),
    });

    expect(result?.resolvedConfigPath).toBe(getResolvedConfigPath(projectDir));
    const raw = JSON.parse(readFileSync(getResolvedConfigPath(projectDir), "utf-8")) as {
      _resolved: { env: string; extendsChain: string[] };
    };
    expect(raw._resolved.env).toBe("development");
    expect(raw._resolved.extendsChain).toEqual(["bos://parent.near/app"]);
  });

  it("emits the missing core route tree even without forced regeneration", async () => {
    rmSync(join(uiDir, "src/routeTree.gen.ts"), { force: true });
    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildRuntimeConfig(uiDir),
    });
    expect(existsSync(join(uiDir, "src/routeTree.gen.ts"))).toBe(true);
    expect(routeTree()).toContain("_public/login");
  });

  it("forceRouteTree regenerates a stale route tree after routes change", async () => {
    const before = routeTree();
    expect(before).not.toContain("_public/extra");
    writeFileSync(
      join(uiDir, "src/routes/_public/extra.tsx"),
      "export const Route = null as never;\n",
    );

    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildRuntimeConfig(uiDir),
    });
    expect(routeTree()).toBe(before);

    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildRuntimeConfig(uiDir),
      forceRouteTree: true,
    });
    expect(routeTree()).toContain("_public/extra");
  });

  it("a cold tree and a warm tree generate byte-identical artifacts (hermetic resolution)", async () => {
    const resolvedConfigPath = getResolvedConfigPath(projectDir);
    rmSync(resolvedConfigPath, { force: true });
    rmSync(join(uiDir, "src/routeTree.gen.ts"), { force: true });

    await generateCodeArtifacts(projectDir, CONFIG, {
      env: "development",
      extendsChain: ["bos://parent.near/app"],
      runtimeConfig: buildRuntimeConfig(uiDir),
    });
    const coldResolved = JSON.parse(readFileSync(resolvedConfigPath, "utf-8")) as {
      _resolved: Record<string, unknown>;
    };
    const coldRouteTree = routeTree();

    await generateCodeArtifacts(projectDir, CONFIG, {
      env: "development",
      extendsChain: ["bos://parent.near/app"],
      runtimeConfig: buildRuntimeConfig(uiDir),
    });
    const warmResolved = JSON.parse(readFileSync(resolvedConfigPath, "utf-8")) as {
      _resolved: Record<string, unknown>;
    };
    // resolvedAt is run-scoped metadata; everything else is byte-stable
    expect({ ...warmResolved._resolved, resolvedAt: undefined }).toEqual({
      ...coldResolved._resolved,
      resolvedAt: undefined,
    });
    expect(warmResolved).toEqual({ ...coldResolved, _resolved: warmResolved._resolved });
    expect(routeTree()).toBe(coldRouteTree);
  });
});

describe("auth.ui artifact targets (#549)", () => {
  let projectDir: string;
  let uiDir: string;
  let authUiDir: string;

  function buildAuthRuntimeConfig(authUiLocalPath: string): RuntimeConfig {
    return {
      ...buildRuntimeConfig(uiDir),
      auth: {
        name: "auth",
        url: "http://localhost:4100",
        entry: "/mf-manifest.json",
        source: "local",
        localPath: authUiLocalPath,
        ui: {
          name: "auth-ui",
          source: "local",
          localPath: authUiLocalPath,
        },
      },
    } as unknown as RuntimeConfig;
  }

  beforeAll(() => {
    projectDir = mkdtempSync(join(tmpdir(), "bos-types-gen-auth-"));
    uiDir = join(projectDir, "ui");
    authUiDir = join(projectDir, "auth-ui");
    writeFileSync(join(projectDir, "bos.config.json"), JSON.stringify(CONFIG));
    cpSync(fixtureSrc, join(uiDir, "src"), { recursive: true });
    cpSync(fixtureSrc, join(authUiDir, "src"), { recursive: true });
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("emits manifest.gen.json + routeTree.gen.ts for a local auth.ui slot", async () => {
    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildAuthRuntimeConfig(authUiDir),
    });

    const manifest = JSON.parse(
      readFileSync(join(authUiDir, "src/manifest.gen.json"), "utf-8"),
    ) as { name: string; routes: Array<{ id: string; file?: string }> };
    expect(manifest.name).toBe("auth");
    expect(manifest.routes.length).toBeGreaterThan(0);
    expect(manifest.routes.some((route) => route.file?.endsWith("login.tsx"))).toBe(true);
    expect(existsSync(join(authUiDir, "src/routeTree.gen.ts"))).toBe(true);
    expect(readFileSync(join(authUiDir, "src/routeTree.gen.ts"), "utf-8")).toContain(
      "_public/login",
    );
  });

  it("is byte-stable across runs (no unconditional rewrite)", async () => {
    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildAuthRuntimeConfig(authUiDir),
    });
    const before = readFileSync(join(authUiDir, "src/manifest.gen.json"), "utf-8");
    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildAuthRuntimeConfig(authUiDir),
    });
    expect(readFileSync(join(authUiDir, "src/manifest.gen.json"), "utf-8")).toBe(before);
  });

  it("regenerates when forceRouteTree is set", async () => {
    writeFileSync(
      join(authUiDir, "src/routes/_public/extra.tsx"),
      "export const Route = null as never;\n",
    );
    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildAuthRuntimeConfig(authUiDir),
    });
    expect(readFileSync(join(authUiDir, "src/routeTree.gen.ts"), "utf-8")).not.toContain(
      "_public/extra",
    );
    await generateCodeArtifacts(projectDir, CONFIG, {
      runtimeConfig: buildAuthRuntimeConfig(authUiDir),
      forceRouteTree: true,
    });
    expect(readFileSync(join(authUiDir, "src/routeTree.gen.ts"), "utf-8")).toContain(
      "_public/extra",
    );
  });
});
