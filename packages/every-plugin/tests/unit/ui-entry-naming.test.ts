import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEV_ENTRY_FILENAME,
  DEV_SERVER_ENTRY_FILENAME,
  HASHED_ENTRY_PATTERN,
  HASHED_SERVER_ENTRY_PATTERN,
  isBuildInvocation,
  uiEntryFilename,
} from "../../src/build/artifact-names";
import { createUiRsbuildConfig } from "../../src/build/ui/rsbuild-config";

vi.mock("@tanstack/router-plugin/rspack", () => ({
  TanStackRouterRspack: vi.fn((options?: unknown) => ({ name: "tanstack-router", options })),
}));

import { TanStackRouterRspack } from "@tanstack/router-plugin/rspack";

const options = {
  workspaceRoot: process.cwd(),
  pkg: { name: "@test/plugin-ui", version: "0.0.0" },
  role: "consumer",
  manifestName: "test-plugin-ui",
  devPort: 0,
  webEntry: "./src/index.ts",
  webExposes: {},
  nodeEntry: "./src/ssr.ts",
  nodeExposes: {},
} as const;

describe("uiEntryFilename", () => {
  it("dev servers emit the fixed dev names — every dev consumer appends them", () => {
    expect(uiEntryFilename({ isBuild: false })).toBe(DEV_ENTRY_FILENAME);
    expect(uiEntryFilename({ isBuild: false, server: true })).toBe(DEV_SERVER_ENTRY_FILENAME);
  });

  it("builds emit content-hashed entry names (atomic-deploys 01)", () => {
    expect(uiEntryFilename({ isBuild: true })).toBe(HASHED_ENTRY_PATTERN);
    expect(uiEntryFilename({ isBuild: true, server: true })).toBe(HASHED_SERVER_ENTRY_PATTERN);
  });
});

describe("isBuildInvocation", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevServer = process.env.BOS_DEV_SERVER;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDevServer === undefined) delete process.env.BOS_DEV_SERVER;
    else process.env.BOS_DEV_SERVER = originalDevServer;
  });

  it("is true without the dev-stack signal — NODE_ENV is not consulted (vitest runs as test, bundler CLIs default production)", () => {
    for (const nodeEnv of ["development", "test", "production"]) {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.BOS_DEV_SERVER;
      expect(isBuildInvocation()).toBe(true);
    }
  });

  it("is false under BOS_DEV_SERVER=1 even in a production-mode environment", () => {
    process.env.NODE_ENV = "production";
    process.env.BOS_DEV_SERVER = "1";
    expect(isBuildInvocation()).toBe(false);
  });
});

describe("createUiRsbuildConfig artifact aliasing", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDevServer = process.env.BOS_DEV_SERVER;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDevServer === undefined) delete process.env.BOS_DEV_SERVER;
    else process.env.BOS_DEV_SERVER = originalDevServer;
  });

  function pluginNames(config: ReturnType<typeof createUiRsbuildConfig>): {
    web: string[];
    node: string[];
  } {
    const pick = (env: unknown): string[] => {
      const environment = env as { plugins?: Array<{ name?: string }> } | undefined;
      return (environment?.plugins ?? []).map((plugin) => plugin?.name ?? "");
    };
    const environments = config.environments as
      | Record<string, { plugins?: Array<{ name?: string }> }>
      | undefined;
    return {
      web: pick(environments?.web),
      node: pick(environments?.node),
    };
  }

  it("skips the dist-aliasing plugin on dev servers (no dist writes exist)", () => {
    process.env.NODE_ENV = "test";
    process.env.BOS_DEV_SERVER = "1";
    const names = pluginNames(createUiRsbuildConfig(options));
    expect(names.web.some((name) => name.includes("hash-artifacts"))).toBe(false);
    expect(names.node.some((name) => name.includes("hash-artifacts"))).toBe(false);
  });

  it("attaches the dist-aliasing plugin on builds", () => {
    process.env.NODE_ENV = "production";
    delete process.env.BOS_DEV_SERVER;
    const names = pluginNames(createUiRsbuildConfig(options));
    expect(names.web.some((name) => name.includes("hash-artifacts"))).toBe(true);
    expect(names.node.some((name) => name.includes("hash-artifacts"))).toBe(true);
  });
});

describe("TanStackRouterRspack route-tree output (#548)", () => {
  const baseOptions = {
    workspaceRoot: process.cwd(),
    pkg: { name: "@test/plugin-ui", version: "0.0.0" },
    role: "consumer",
    manifestName: "test-plugin-ui",
    devPort: 0,
    webEntry: "./src/index.ts",
    webExposes: {},
    nodeEntry: "./src/ssr.ts",
    nodeExposes: {},
  } as const;

  beforeEach(() => vi.mocked(TanStackRouterRspack).mockClear());

  function routerPluginCalls(env: unknown): unknown[] {
    const cfg = { plugins: [] as unknown[] };
    env?.tools?.rspack?.(cfg as Record<string, unknown>);
    return vi.mocked(TanStackRouterRspack).mock.calls.map((call) => call[0]);
  }

  it("web env pins generatedRouteTree inside the ui workspace root — plugin-local builds run rspack from the plugin root", () => {
    const config = createUiRsbuildConfig({
      ...baseOptions,
      workspaceRoot: "/workspace/plugins/auth-ui",
    });
    const calls = routerPluginCalls(config.environments?.web);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.generatedRouteTree).toBe(
      join("/workspace/plugins/auth-ui", "src/routeTree.gen.ts"),
    );
  });

  it("node env keeps writing the route tree to the scratch path", () => {
    const config = createUiRsbuildConfig(baseOptions);
    const calls = routerPluginCalls(config.environments?.node);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.generatedRouteTree).toBe(
      "./node_modules/.cache/manifest-compose/routeTree.node.gen.ts",
    );
  });
});
