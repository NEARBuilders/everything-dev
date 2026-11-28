import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigPathCache } from "../../src/config";
import { openResolution } from "../../src/services/resolution/session";

vi.mock("../../src/services/registry/fastkv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/registry/fastkv")>();
  return {
    ...actual,
    fetchBosConfigFromFastKv: async () => {
      throw new Error("[test] network disabled — stub fetchBosConfigFromFastKv");
    },
  };
});

vi.mock("../../src/services/codegen/api-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/codegen/api-contract")>();
  return {
    ...actual,
    fetchApiPluginManifest: async () => {
      throw new Error("[test] network disabled — stub fetchApiPluginManifest");
    },
  };
});

vi.mock("../../src/utils/http-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/http-client")>();
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

describe("asComposableEntry resolves targeted entries against a local parent", () => {
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
      join(parentDir, "provider.json"),
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
            auth: {
              name: "auth-plugin",
              production: "https://auth.authchild.dev",
            },
          },
          plugins: {
            myplugin: {
              production: "https://myplugin.child.dev",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(childDir, "bos.app.ts"),
      `export default ${JSON.stringify(
        {
          name: "child",
          account: "child.near",
          domain: "child.dev",
          extends: "../parent/provider.json",
          plugins: {
            myplugin: {
              extends: "../parent/provider.json#plugins.myplugin",
              variables: { namespace: "child.near" },
            },
          },
          host: { development: "http://localhost:3000" },
          ui: { development: "http://localhost:3003" },
          api: { development: "http://localhost:3001" },
        },
        null,
        2,
      )};
`,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not throw when the child targets a parent entry", async () => {
    resetConfigPathCache();
    const session = await openResolution({ cwd: childDir });
    expect(session).not.toBeNull();
  });

  it("resolves plugin values from the extends target with child-wins variables", async () => {
    resetConfigPathCache();
    const session = await openResolution({ cwd: childDir });
    expect(session?.runtime.plugins?.myplugin).toBeDefined();
    expect(session?.runtime.plugins?.myplugin?.url).toBe("https://myplugin.child.dev");
  });

  it("resolves a targeted app.auth slot from the parent", async () => {
    const authChildDir = join(testDir, "auth-child");
    mkdirSync(authChildDir, { recursive: true });

    writeFileSync(
      join(authChildDir, "bos.app.ts"),
      `export default ${JSON.stringify(
        {
          name: "authchild",
          account: "authchild.near",
          domain: "authchild.dev",
          extends: "../parent/provider.json",
          auth: {
            extends: "../parent/provider.json#app.auth",
            variables: { account: "authchild.near" },
          },
          host: { development: "http://localhost:3000" },
          ui: { development: "http://localhost:3003" },
          api: { development: "http://localhost:3001" },
        },
        null,
        2,
      )};
`,
    );

    resetConfigPathCache();
    const session = await openResolution({ cwd: authChildDir });
    expect(session).not.toBeNull();
    expect(session?.config.app?.auth?.name).toBe("auth-plugin");
    expect(session?.config.app?.auth?.production).toBe("https://auth.authchild.dev");
  });
});
