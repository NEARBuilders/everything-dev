import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clearConfigCache, loadResolvedConfig } from "../../src/config";

vi.mock("../../src/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: async () => {
      throw new Error("[test] network disabled — stub fetchBosConfigFromFastKv");
    },
  };
});

vi.mock("../../src/api-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api-contract")>();
  return {
    ...actual,
    fetchApiPluginManifest: async () => {
      throw new Error("[test] network disabled — stub fetchApiPluginManifest");
    },
  };
});

vi.mock("../../src/http-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/http-client")>();
  return {
    ...actual,
    fetchResponse: async () => {
      throw new Error("[test] network disabled — stub fetchResponse");
    },
    fetchEff: (() => {
      throw new Error("[test] network disabled — stub fetchEff");
    }) as unknown as typeof actual.fetchEff,
  };
});

describe("asComposableEntry handles undefined parent entries", () => {
  let testDir: string;
  let parentDir: string;
  let childDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-composable-undefined-"));
    parentDir = join(testDir, "parent");
    childDir = join(testDir, "child");
    mkdirSync(parentDir, { recursive: true });
    mkdirSync(childDir, { recursive: true });

    writeFileSync(
      join(parentDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "parent.near",
          domain: "parent.dev",
          app: {
            host: {
              development: "http://localhost:3000",
              production: "https://host.parent.dev",
            },
            ui: {
              name: "ui",
              development: "http://localhost:3003",
              production: "https://ui.parent.dev",
            },
            api: {
              name: "api",
              development: "http://localhost:3001",
              production: "https://api.parent.dev",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(childDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "child.near",
          domain: "child.dev",
          extends: "../parent/bos.config.json",
          plugins: {
            myplugin: {
              extends: "../parent/bos.config.json#plugins.myplugin",
              production: "https://myplugin.child.dev",
              variables: { namespace: "child.near" },
            },
          },
          app: {
            host: {
              development: "http://localhost:3000",
              production: "https://host.child.dev",
            },
            ui: {
              name: "ui",
              development: "http://localhost:3003",
              production: "https://ui.child.dev",
            },
            api: {
              name: "api",
              development: "http://localhost:3001",
              production: "https://api.child.dev",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not throw when extends targets a plugin missing from parent config", async () => {
    clearConfigCache();
    const loaded = await loadResolvedConfig({ cwd: childDir });
    expect(loaded).not.toBeNull();
  });

  it("resolves plugin to child-only values when parent lacks the plugin", async () => {
    clearConfigCache();
    const loaded = await loadResolvedConfig({ cwd: childDir });
    expect(loaded?.runtime.plugins?.myplugin).toBeDefined();
    expect(loaded?.runtime.plugins?.myplugin?.url).toBe("https://myplugin.child.dev");
  });

  it("does not throw when extends targets app.auth missing from parent config", async () => {
    const authChildDir = join(testDir, "auth-child");
    mkdirSync(authChildDir, { recursive: true });

    writeFileSync(
      join(authChildDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "authchild.near",
          domain: "authchild.dev",
          extends: "../parent/bos.config.json",
          app: {
            host: {
              development: "http://localhost:3000",
              production: "https://host.authchild.dev",
            },
            ui: {
              name: "ui",
              development: "http://localhost:3003",
              production: "https://ui.authchild.dev",
            },
            api: {
              name: "api",
              development: "http://localhost:3001",
              production: "https://api.authchild.dev",
            },
            auth: {
              extends: "../parent/bos.config.json#app.auth",
              name: "auth-plugin",
              production: "https://auth.authchild.dev",
              variables: { account: "authchild.near" },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    clearConfigCache();
    const loaded = await loadResolvedConfig({ cwd: authChildDir });
    expect(loaded).not.toBeNull();
    expect(loaded?.config.app?.auth?.name).toBe("auth-plugin");
    expect(loaded?.config.app?.auth?.production).toBe("https://auth.authchild.dev");
  });
});
