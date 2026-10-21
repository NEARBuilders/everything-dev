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
