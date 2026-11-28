import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUiRsbuildConfig, ssrContainerCleanKeep } from "../../src/build/ui/rsbuild-config";

const SSR_ROOT = join("/workspace", "ui", "dist", "ssr");

const options = {
  workspaceRoot: "/workspace/ui",
  pkg: { name: "@test/plugin-ui", version: "0.0.0" },
  role: "consumer",
  manifestName: "test-plugin-ui",
  devPort: 0,
  webEntry: "./src/index.ts",
  webExposes: {},
  nodeEntry: "./src/ssr.ts",
  nodeExposes: {},
} as const;

describe("ssrContainerCleanKeep", () => {
  it("keeps the SSR container subtree for a web-only build (#940)", () => {
    const keep = ssrContainerCleanKeep(false, SSR_ROOT);
    expect(keep).toBeDefined();
    const pattern = keep!.keep[0]!;
    expect(pattern.test(SSR_ROOT)).toBe(true);
    expect(pattern.test(join(SSR_ROOT, "remoteEntry.server.js"))).toBe(true);
    expect(pattern.test(join("/workspace/ui", "dist", "static", "js", "x.js"))).toBe(false);
    expect(pattern.test(join("/workspace/ui", "dist", "manifest.gen.json"))).toBe(false);
  });

  it("keeps nothing when the node environment builds — its own dist root cleans and re-emits the container", () => {
    expect(ssrContainerCleanKeep(true, SSR_ROOT)).toBeUndefined();
  });

  it("is inert on paths outside the keep prefix", () => {
    const keep = ssrContainerCleanKeep(false, "/workspace/ui/dist/ssr");
    expect(keep!.keep[0]!.test("/workspace/ui/dist-ssr/remoteEntry.server.js")).toBe(false);
    expect(keep!.keep[0]!.test("/other/ui/dist/ssr")).toBe(false);
  });
});

describe("createUiRsbuildConfig container preservation", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSsr = process.env.BOS_SSR;
  const originalDeploy = process.env.DEPLOY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSsr === undefined) delete process.env.BOS_SSR;
    else process.env.BOS_SSR = originalSsr;
    if (originalDeploy === undefined) delete process.env.DEPLOY;
    else process.env.DEPLOY = originalDeploy;
  });

  function environments(config: ReturnType<typeof createUiRsbuildConfig>) {
    return config.environments as Record<
      string,
      { output?: { cleanDistPath?: unknown } } | undefined
    >;
  }

  it("the plain train build (no BOS_SSR, dev NODE_ENV) excludes the node env and keeps dist/ssr", () => {
    process.env.NODE_ENV = "development";
    delete process.env.BOS_SSR;
    delete process.env.DEPLOY;

    const config = createUiRsbuildConfig(options);
    const envs = environments(config);
    expect(envs.node).toBeUndefined();
    const keep = envs.web?.output?.cleanDistPath as { keep: RegExp[] } | undefined;
    expect(keep?.keep[0]?.test(SSR_ROOT)).toBe(true);
  });

  it("an SSR build includes the node env with no keep override — the container re-emits", () => {
    process.env.NODE_ENV = "development";
    process.env.BOS_SSR = "1";
    delete process.env.DEPLOY;

    const config = createUiRsbuildConfig(options);
    const envs = environments(config);
    expect(envs.node).toBeDefined();
    expect(envs.web?.output?.cleanDistPath).toBeUndefined();
  });

  it("a deploy build includes the node env with no keep override", () => {
    process.env.NODE_ENV = "production";
    delete process.env.BOS_SSR;
    process.env.DEPLOY = "true";

    const config = createUiRsbuildConfig(options);
    const envs = environments(config);
    expect(envs.node).toBeDefined();
    expect(envs.web?.output?.cleanDistPath).toBeUndefined();
  });
});
