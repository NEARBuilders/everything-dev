import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCatalogChainSource } from "../../src/cli/init";
import { clearConfigCache, loadResolvedConfig } from "../../src/config";
import { mergeBosConfigWithExtends, rebuildOrderedConfig } from "../../src/merge";

const BASE_CONFIG = {
  account: "parent.near",
  domain: "parent.dev",
  app: {
    host: { development: "http://localhost:3000", production: "https://host.parent.dev" },
    ui: { name: "ui", development: "http://localhost:3003", production: "https://ui.parent.dev" },
    api: {
      name: "api",
      development: "http://localhost:3001",
      production: "https://api.parent.dev",
    },
  },
};

const CHILD_CONFIG = {
  account: "child.near",
  domain: "child.dev",
  extends: "../parent/bos.config.json",
  app: {
    host: { development: "http://localhost:3000", production: "https://host.child.dev" },
    ui: { name: "ui", development: "http://localhost:3003", production: "https://ui.child.dev" },
    api: { name: "api", development: "http://localhost:3001", production: "https://api.child.dev" },
  },
};

describe("extends chain", () => {
  let testDir: string;
  let parentDir: string;
  let childDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-extends-chain-"));
    parentDir = join(testDir, "parent");
    childDir = join(testDir, "child");
    mkdirSync(parentDir, { recursive: true });
    mkdirSync(childDir, { recursive: true });

    writeFileSync(
      join(parentDir, "bos.config.json"),
      `${JSON.stringify(
        rebuildOrderedConfig({
          ...BASE_CONFIG,
          repository: "https://github.com/parent",
          plugins: {
            apps: { development: "local:plugins/apps" },
            projects: { development: "local:plugins/projects" },
          },
          shared: {
            ui: {
              effect: { version: "3.20.0", singleton: true },
            },
          },
        }),
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(childDir, "bos.config.json"),
      `${JSON.stringify(
        rebuildOrderedConfig({
          ...CHILD_CONFIG,
          plugins: {
            apps: { variables: { namespace: "child.near" } },
            projects: null,
          },
          shared: {
            ui: {
              effect: { version: "3.21.0" },
            },
          },
        }),
        null,
        2,
      )}\n`,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("child overrides parent scalars via extends", () => {
    const parent = {
      ...BASE_CONFIG,
      repository: "https://github.com/parent",
    };
    const child = {
      account: "child.near",
      domain: "child.dev",
    };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    expect(merged.account).toBe("child.near");
    expect(merged.domain).toBe("child.dev");
    expect(merged.repository).toBe("https://github.com/parent");
  });

  it("null-sentinel does not inherit parent plugins", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        projects: { development: "local:plugins/projects" },
      },
    };
    const child = {
      plugins: {
        projects: null,
      },
    };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    const plugins = merged.plugins as Record<string, unknown>;
    expect(plugins.apps).toBeUndefined();
    expect(plugins.projects).toBeUndefined();
  });

  it("false-sentinel does not inherit parent plugins", () => {
    const parent = {
      plugins: {
        apps: { development: "local:plugins/apps" },
        projects: { development: "local:plugins/projects" },
      },
    };
    const child = {
      plugins: {
        projects: false,
      },
    };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    const plugins = merged.plugins as Record<string, unknown>;
    expect(plugins.apps).toBeUndefined();
    expect(plugins.projects).toBe(false);
  });

  it("deep merges app.api.shared — child version overrides, parent singleton preserved", () => {
    const parent = {
      app: {
        api: {
          shared: {
            effect: { version: "3.20.0", singleton: true },
            zod: { version: "4.2.0", singleton: true },
          },
        },
      },
    };
    const child = {
      app: {
        api: {
          shared: {
            effect: { version: "3.21.0" },
          },
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    const api = (merged.app as Record<string, unknown>).api as Record<string, unknown>;
    const shared = api.shared as Record<string, Record<string, unknown>>;
    expect(shared.effect.version).toBe("3.21.0");
    expect(shared.effect.singleton).toBe(true);
    expect(shared.zod.version).toBe("4.2.0");
  });

  it("secrets arrays are unioned across extends", () => {
    const parent = {
      app: {
        api: {
          name: "api",
          secrets: ["DB_URL", "DB_TOKEN"],
        },
      },
    };
    const child = {
      app: {
        api: {
          name: "api",
          secrets: ["DB_URL", "EXTRA_SECRET"],
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    const api = (merged.app as Record<string, Record<string, unknown>>).api as Record<
      string,
      unknown
    >;
    expect(api.secrets).toContain("DB_URL");
    expect(api.secrets).toContain("DB_TOKEN");
    expect(api.secrets).toContain("EXTRA_SECRET");
  });

  it("plugin config comes only from the child across extends", () => {
    const parent = {
      plugins: {
        myplugin: {
          variables: { namespace: "parent.near", region: "us-east" },
        },
      },
    };
    const child = {
      plugins: {
        myplugin: {
          variables: { namespace: "child.near" },
        },
      },
    };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    const myplugin = (merged.plugins as Record<string, Record<string, unknown>>).myplugin as Record<
      string,
      unknown
    >;
    expect(myplugin.variables).toEqual({ namespace: "child.near" });
  });

  it("resolved config does not inherit parent plugins through extends", async () => {
    clearConfigCache();
    const loaded = await loadResolvedConfig({ cwd: childDir });
    expect(loaded?.config.plugins).toEqual({
      apps: { variables: { namespace: "child.near" } },
    });
  });

  it("canonical ordering is preserved after merge", () => {
    const parent = {
      shared: {},
      plugins: {},
      app: {},
      repository: "https://github.com/parent",
      account: "parent.near",
      domain: "parent.dev",
    };
    const child = { account: "child.near" };
    const merged = mergeBosConfigWithExtends(parent as any, child as any);
    const keys = Object.keys(merged);
    expect(keys.indexOf("account")).toBeLessThan(keys.indexOf("repository"));
    expect(keys.indexOf("repository")).toBeLessThan(keys.indexOf("app"));
    expect(keys.includes("plugins")).toBe(false);
    expect(keys.indexOf("app")).toBeLessThan(keys.indexOf("shared"));
  });

  it("merges parent catalogs across the extends chain from root to leaf", async () => {
    const grandDir = join(testDir, "grand");
    mkdirSync(grandDir, { recursive: true });
    writeFileSync(
      join(parentDir, "package.json"),
      `${JSON.stringify(
        {
          workspaces: {
            catalog: {
              effect: "3.21.0",
              "better-auth": "1.6.9",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(parentDir, "bos.config.json"),
      `${JSON.stringify(
        rebuildOrderedConfig({
          ...BASE_CONFIG,
          repository: "https://github.com/parent",
          extends: "../grand/bos.config.json",
        }),
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(grandDir, "package.json"),
      `${JSON.stringify(
        {
          workspaces: {
            catalog: {
              effect: "3.20.0",
              zod: "4.3.6",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(grandDir, "bos.config.json"),
      `${JSON.stringify(
        rebuildOrderedConfig({
          ...BASE_CONFIG,
          repository: "https://github.com/root",
        }),
        null,
        2,
      )}\n`,
    );

    const source = await resolveCatalogChainSource({
      extendsAccount: "parent.near",
      extendsGateway: "parent.dev",
      sourceDir: parentDir,
    });

    expect(source.catalog).toEqual({
      effect: "3.21.0",
      zod: "4.3.6",
      "better-auth": "1.6.9",
    });
    expect(source.repository).toBe("https://github.com/root");
    expect(source.extendsChain).toEqual([
      "bos://parent.near/parent.dev",
      join(grandDir, "bos.config.json"),
    ]);
  });
});

describe("circular extends detection", () => {
  it("loadConfig throws on circular extends", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-circular-"));
    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify({
          account: "test.near",
          extends: "./bos.config.json",
          app: {
            host: { development: "http://localhost:3000", production: "https://h.com" },
            ui: { name: "ui", development: "http://localhost:3003", production: "https://u.com" },
            api: { name: "api", development: "http://localhost:3001", production: "https://a.com" },
          },
        })}\n`,
      );

      clearConfigCache();
      await expect(loadResolvedConfig({ cwd: testDir })).rejects.toThrow(/Circular extends/);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("multi-level extends chain", () => {
  it("grandchild inherits shared config but not parent plugins through parent", () => {
    const grandparent = {
      account: "gp.near",
      domain: "gp.dev",
      repository: "https://github.com/gp",
      shared: {
        ui: {
          effect: { version: "3.19.0", singleton: true, strictVersion: false },
        },
      },
      plugins: {
        apps: { development: "local:plugins/apps" },
        projects: { development: "local:plugins/projects" },
        analytics: { development: "local:plugins/analytics" },
      },
    };
    const parent = {
      account: "p.near",
      shared: {
        ui: {
          effect: { version: "3.20.0" },
        },
      },
      plugins: {
        analytics: null,
      },
    };
    const child = {
      account: "c.near",
      domain: "c.dev",
    };

    const firstMerge = mergeBosConfigWithExtends(grandparent as any, parent as any);
    const secondMerge = mergeBosConfigWithExtends(firstMerge as any, child as any);

    expect(secondMerge.account).toBe("c.near");
    expect(secondMerge.domain).toBe("c.dev");
    expect(secondMerge.repository).toBe("https://github.com/gp");

    const ui = (secondMerge.shared as Record<string, unknown>).ui as Record<
      string,
      Record<string, unknown>
    >;
    expect(ui.effect.version).toBe("3.20.0");
    expect(ui.effect.singleton).toBe(true);
    expect(ui.effect.strictVersion).toBe(false);

    expect(secondMerge.plugins).toBeUndefined();
  });
});
