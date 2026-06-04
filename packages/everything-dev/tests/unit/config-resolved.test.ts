import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  loadLocalConfig,
  loadResolvedConfig,
  readBosConfigForBuild,
  resolveBosConfigPath,
  writeResolvedConfig,
} from "../../src/config";

describe("writeResolvedConfig / loadResolvedConfig", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-resolved-config-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes .bos/bos.resolved-config.json with _resolved metadata", () => {
    const config = {
      account: "test.near",
      domain: "test.dev",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", development: "local:ui", production: "https://ui.example.com" },
        api: { name: "api", development: "local:api", production: "https://api.example.com" },
      },
    } as any;
    writeResolvedConfig(testDir, config, "development", ["bos://parent.near/config"]);

    const resolvedPath = getResolvedConfigPath(testDir);
    expect(existsSync(resolvedPath)).toBe(true);

    const raw = JSON.parse(readFileSync(resolvedPath, "utf-8")) as Record<string, unknown>;
    expect(raw._resolved).toBeDefined();
    expect((raw._resolved as Record<string, unknown>).env).toBe("development");
    expect((raw._resolved as Record<string, unknown>).extendsChain).toEqual([
      "bos://parent.near/config",
    ]);
    expect(raw.account).toBe("test.near");
    expect(raw.domain).toBe("test.dev");
  });

  it("loadResolvedConfig reads back the merged config", () => {
    const config = {
      account: "test.near",
      domain: "test.dev",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", development: "local:ui", production: "https://ui.example.com" },
        api: { name: "api", development: "local:api", production: "https://api.example.com" },
      },
    } as any;
    writeResolvedConfig(testDir, config, "development");

    const loaded = loadGeneratedResolvedConfig(testDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.account).toBe("test.near");
  });

  it("loadResolvedConfig returns null when file doesn't exist", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "bos-resolved-empty-"));
    try {
      expect(loadGeneratedResolvedConfig(emptyDir)).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("resolveBosConfigPath returns resolved config when present", () => {
    const config = {
      account: "test.near",
      domain: "test.dev",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", development: "local:ui", production: "https://ui.example.com" },
        api: { name: "api", development: "local:api", production: "https://api.example.com" },
      },
    } as any;
    writeResolvedConfig(testDir, config, "development");

    const result = resolveBosConfigPath(testDir);
    expect(result).toBe(getResolvedConfigPath(testDir));
  });

  it("resolveBosConfigPath falls back to bos.config.json when resolved config absent", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "bos-resolved-fallback-"));
    try {
      const result = resolveBosConfigPath(emptyDir);
      expect(result).toBe(join(emptyDir, "bos.config.json"));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("overwriting resolved config updates the file", () => {
    const config1 = {
      account: "first.near",
      domain: "first.dev",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", development: "local:ui", production: "https://ui.example.com" },
        api: { name: "api", development: "local:api", production: "https://api.example.com" },
      },
    } as any;
    writeResolvedConfig(testDir, config1, "development");

    const config2 = {
      account: "second.near",
      domain: "second.dev",
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", development: "local:ui", production: "https://ui.example.com" },
        api: { name: "api", development: "local:api", production: "https://api.example.com" },
      },
    } as any;
    writeResolvedConfig(testDir, config2, "development");

    const loaded = loadGeneratedResolvedConfig(testDir);
    expect(loaded!.account).toBe("second.near");
    expect(loaded!.domain).toBe("second.dev");
  });
});

describe("readBosConfigForBuild", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "bos-build-config-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("reads from resolved config when present, stripping _resolved", () => {
    const config = {
      account: "test.near",
      domain: "test.dev",
      shared: { ui: { effect: { version: "3.21.0" } } },
      app: {
        host: { development: "local:host", production: "https://host.example.com" },
        ui: { name: "ui", development: "local:ui", production: "https://ui.example.com" },
        api: { name: "api", development: "local:api", production: "https://api.example.com" },
      },
    } as any;
    writeResolvedConfig(testDir, config, "development");

    const result = readBosConfigForBuild(testDir);
    expect(result._resolved).toBeUndefined();
    expect(result.account).toBe("test.near");
    expect((result.shared as Record<string, unknown>).ui).toBeDefined();
  });

  it("falls back to bos.config.json when resolved config absent", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "bos-build-fallback-"));
    try {
      writeFileSync(
        join(emptyDir, "bos.config.json"),
        JSON.stringify({
          account: "fallback.near",
          app: {
            host: { development: "local:host", production: "https://h.com" },
            ui: { name: "ui", development: "local:ui", production: "https://u.com" },
            api: { name: "api", development: "local:api", production: "https://a.com" },
          },
        }),
      );

      const result = readBosConfigForBuild(emptyDir);
      expect(result.account).toBe("fallback.near");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("loadConfig plugin runtime filtering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits plugin entries that resolve to neither a local path nor a production URL", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-runtime-"));

    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              settings: {
                development: "local:plugins/settings",
              },
            },
            app: {
              host: {
                development: "http://localhost:3000",
                production: "https://host.example.com",
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const loaded = await loadResolvedConfig({ cwd: testDir });

      expect(loaded).not.toBeNull();
      expect(loaded?.runtime.plugins).toBeUndefined();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("warns and uses production when a plugin has no development target", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-runtime-"));

    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              settings: {
                production: "https://settings.example.com",
              },
            },
            app: {
              host: {
                development: "http://localhost:3000",
                production: "https://host.example.com",
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const loaded = await loadResolvedConfig({ cwd: testDir });

      expect(loaded?.runtime.plugins?.settings?.source).toBe("remote");
      expect(loaded?.runtime.plugins?.settings?.url).toBe("https://settings.example.com");
      expect(loaded?.warnings).toContain(
        '[Config] No development target for "plugins.settings", using production',
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("warns and uses production when a local development target is missing", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-runtime-"));

    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              settings: {
                development: "local:plugins/settings",
                production: "https://settings.example.com",
              },
            },
            app: {
              host: {
                development: "http://localhost:3000",
                production: "https://host.example.com",
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const loaded = await loadResolvedConfig({ cwd: testDir });

      expect(loaded?.runtime.plugins?.settings?.source).toBe("remote");
      expect(loaded?.runtime.plugins?.settings?.url).toBe("https://settings.example.com");
      expect(loaded?.warnings).toContain(
        '[Config] Could not load local target for "plugins.settings", using production',
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("errors when extends is unreachable without a local fallback", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-runtime-"));

    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              settings: {
                extends: "./missing-provider/bos.config.json",
                production: "https://settings.example.com",
              },
            },
            app: {
              host: {
                development: "http://localhost:3000",
                production: "https://host.example.com",
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      await expect(loadResolvedConfig({ cwd: testDir })).rejects.toThrow(
        "missing-provider/bos.config.json",
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("uses an existing local development path when extends is unreachable", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-runtime-"));

    try {
      const localPluginDir = join(testDir, "plugins", "settings");
      mkdirSync(localPluginDir, { recursive: true });
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              settings: {
                extends: "./missing-provider/bos.config.json",
                development: "local:plugins/settings",
                production: "https://settings.example.com",
              },
            },
            app: {
              host: {
                development: "http://localhost:3000",
                production: "https://host.example.com",
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
              },
            },
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(join(localPluginDir, "package.json"), '{"name":"settings"}\n');

      const loaded = await loadResolvedConfig({ cwd: testDir });

      expect(loaded?.runtime.plugins?.settings?.source).toBe("local");
      expect(loaded?.runtime.plugins?.settings?.localPath).toBe(localPluginDir);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("preserves nested variable values in auth and plugin runtime config", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-nested-variables-"));

    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            app: {
              host: {
                development: "http://localhost:3000",
                production: "https://host.example.com",
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
              },
              auth: {
                name: "auth",
                production: "https://auth.example.com",
                variables: {
                  baseUrl: "https://auth.everything.near",
                  trustedOrigins: ["https://everything.dev", "https://*.everything.dev"],
                  passkey: {
                    rpID: "everything.dev",
                    rpName: "Better NEAR Auth",
                  },
                  siwn: {
                    recipients: {
                      mainnet: "auth.everything.near",
                      testnet: "dev.allthethings.testnet",
                    },
                    relayer: {
                      enabled: true,
                      retries: 3,
                    },
                  },
                },
              },
            },
            plugins: {
              settings: {
                production: "https://settings.example.com",
                variables: {
                  sections: ["profile", "security"],
                  featureFlags: {
                    passkeys: true,
                    maxSessions: 5,
                  },
                },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const loaded = await loadResolvedConfig({ cwd: testDir, env: "production" });

      expect(loaded?.runtime.auth?.variables).toEqual({
        baseUrl: "https://auth.everything.near",
        trustedOrigins: ["https://everything.dev", "https://*.everything.dev"],
        passkey: {
          rpID: "everything.dev",
          rpName: "Better NEAR Auth",
        },
        siwn: {
          recipients: {
            mainnet: "auth.everything.near",
            testnet: "dev.allthethings.testnet",
          },
          relayer: {
            enabled: true,
            retries: 3,
          },
        },
      });
      expect(loaded?.runtime.plugins?.settings?.variables).toEqual({
        sections: ["profile", "security"],
        featureFlags: {
          passkeys: true,
          maxSessions: 5,
        },
      });
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("local vs resolved config loading", () => {
  it("loads the raw child config by default and resolves extends separately", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "bos-config-local-"));
    const parentDir = join(rootDir, "parent");
    const childDir = join(rootDir, "child");

    try {
      mkdirSync(parentDir, { recursive: true });
      mkdirSync(childDir, { recursive: true });

      writeFileSync(
        join(parentDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "parent.near",
            app: {
              host: { development: "local:host", production: "https://host.parent.dev" },
              ui: { name: "ui", development: "local:ui", production: "https://ui.parent.dev" },
              api: { name: "api", development: "local:api", production: "https://api.parent.dev" },
              auth: { development: "local:plugins/auth", production: "https://auth.parent.dev" },
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
            extends: "../parent/bos.config.json",
            app: {
              ui: { name: "ui", development: "local:ui" },
              api: { name: "api", development: "local:api" },
            },
          },
          null,
          2,
        )}\n`,
      );

      const local = await loadLocalConfig({ cwd: childDir });
      const resolved = await loadResolvedConfig({ cwd: childDir });

      expect(local?.config.app?.host).toBeUndefined();
      expect(local?.config.app?.auth).toBeUndefined();
      expect(resolved?.config.app.host.production).toBe("https://host.parent.dev");
      expect(resolved?.config.app.auth?.production).toBe("https://auth.parent.dev");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
