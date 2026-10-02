import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  findConfigPath,
  getResolvedConfigPath,
  loadGeneratedResolvedConfig,
  readAuthoredConfigInput,
  readBosConfigForBuild,
  resetConfigPathCache,
  resolveBosConfigPath,
  writeResolvedConfig,
} from "../../src/config";
import { openResolution } from "../../src/resolution/session";

vi.mock("../../src/version-manifest-resolve", () => ({
  resolveSlotVersion: vi.fn(async () => ({
    entryUrl: "https://cdn.example.test/remoteEntry.aaa.js",
    entryIntegrity: "sha384-entry",
  })),
  clearSlotVersionCache: vi.fn(),
}));

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

describe("findConfigPath cache", () => {
  afterEach(() => {
    resetConfigPathCache();
  });

  it("normalizes a relative working directory before walking parents", () => {
    expect(findConfigPath(".")).toBe(findConfigPath(process.cwd()));
  });

  it("clears cached misses when the config file is created", () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-path-cache-"));

    try {
      expect(findConfigPath(testDir)).toBeNull();
      writeFileSync(join(testDir, "bos.config.json"), "{}");
      expect(findConfigPath(testDir)).toBeNull();

      resetConfigPathCache();

      expect(findConfigPath(testDir)).toBe(join(testDir, "bos.config.json"));
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

describe("writeResolvedConfig / loadGeneratedResolvedConfig", () => {
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

  it("loadGeneratedResolvedConfig reads back the merged config", () => {
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

  it("loadGeneratedResolvedConfig returns null when file doesn't exist", () => {
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
              example: {
                development: "local:plugins/example",
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

      const session = await openResolution({ cwd: testDir });

      expect(session).not.toBeNull();
      expect(session?.runtime.plugins).toBeUndefined();
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
              example: {
                production: "https://example.example.com",
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

      const session = await openResolution({ cwd: testDir });

      expect(session?.runtime.plugins?.example?.source).toBe("remote");
      expect(session?.runtime.plugins?.example?.url).toBe("https://example.example.com");
      expect(session?.warnings).toContain(
        '[Config] No development target for "plugins.example", using production',
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
              example: {
                development: "local:plugins/example",
                production: "https://example.example.com",
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

      const session = await openResolution({ cwd: testDir });

      expect(session?.runtime.plugins?.example?.source).toBe("remote");
      expect(session?.runtime.plugins?.example?.url).toBe("https://example.example.com");
      expect(session?.warnings).toContain(
        '[Config] Could not load local target for "plugins.example", using production',
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
              example: {
                extends: "./missing-provider/bos.config.json",
                production: "https://example.example.com",
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

      await expect(openResolution({ cwd: testDir })).rejects.toThrow(
        "missing-provider/bos.config.json",
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("uses an existing local development path when extends is unreachable", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-runtime-"));

    try {
      const localPluginDir = join(testDir, "plugins", "example");
      mkdirSync(localPluginDir, { recursive: true });
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              example: {
                extends: "./missing-provider/bos.config.json",
                development: "local:plugins/example",
                production: "https://example.example.com",
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
      writeFileSync(join(localPluginDir, "package.json"), '{"name":"example"}\n');

      const session = await openResolution({ cwd: testDir });

      expect(session?.runtime.plugins?.example?.source).toBe("local");
      expect(session?.runtime.plugins?.example?.localPath).toBe(localPluginDir);
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
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
              },
              ui: {
                name: "ui",
                development: "http://localhost:3003",
                production: "https://ui.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
              },
              api: {
                name: "api",
                development: "http://localhost:3001",
                production: "https://api.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
              },
              auth: {
                name: "auth",
                production: "https://auth.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
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
              example: {
                production: "https://example.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
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

      const session = await openResolution({ cwd: testDir, env: "production" });

      expect(session?.runtime.auth?.variables).toEqual({
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
      expect(session?.runtime.plugins?.example?.variables).toEqual({
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
  it("resolves plugin as remote when listed in remotePlugins", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-remote-plugins-"));

    try {
      const localPluginDir = join(testDir, "plugins", "example");
      mkdirSync(localPluginDir, { recursive: true });
      writeFileSync(join(localPluginDir, "package.json"), '{"name":"example"}\n');

      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              example: {
                development: "local:plugins/example",
                production: "https://example.example.com",
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

      const session = await openResolution({ cwd: testDir, remotePlugins: ["example"] });

      expect(session?.runtime.plugins?.example).toBeDefined();
      expect(session?.runtime.plugins?.example?.source).toBe("remote");
      expect(session?.runtime.plugins?.example?.url).toBe("https://example.example.com");
      expect(session?.runtime.plugins?.example?.localPath).toBeUndefined();
      expect(session?.runtime.plugins?.example?.entry).toBe(
        "https://example.example.com/mf-manifest.json",
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("resolves plugin as local without remotePlugins (default)", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-remote-plugins-"));

    try {
      const localPluginDir = join(testDir, "plugins", "example");
      mkdirSync(localPluginDir, { recursive: true });
      writeFileSync(join(localPluginDir, "package.json"), '{"name":"example"}\n');

      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            plugins: {
              example: {
                development: "local:plugins/example",
                production: "https://example.example.com",
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

      const session = await openResolution({ cwd: testDir });

      expect(session?.runtime.plugins?.example).toBeDefined();
      expect(session?.runtime.plugins?.example?.source).toBe("local");
      expect(session?.runtime.plugins?.example?.localPath).toBe(localPluginDir);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("derives the auth mirror (plugins.auth) from app.auth when the authored config has no plugins.auth", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "bos-config-auth-mirror-"));

    try {
      writeFileSync(
        join(testDir, "bos.config.json"),
        `${JSON.stringify(
          {
            account: "test.near",
            domain: "test.dev",
            app: {
              host: {
                development: "local:host",
                production: "https://host.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
              },
              ui: {
                name: "ui",
                development: "local:ui",
                production: "https://ui.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
              },
              api: {
                name: "api",
                development: "local:api",
                production: "https://api.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
              },
              auth: {
                name: "auth",
                development: "local:plugins/auth",
                production: "https://auth.example.com",
                pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
                ui: {
                  name: "_everything_dev_auth_plugin",
                  development: "local:plugins/auth/ui",
                  production: "https://auth-ui.example.com",
                  pin: { manifest: "versions/8f3ac1d2feedbeef.json", integrity: "sha384-pin" },
                },
              },
            },
            plugins: {},
          },
          null,
          2,
        )}\n`,
      );

      const session = await openResolution({ cwd: testDir, env: "production" });

      expect(session?.runtime.auth?.entryUrl).toBe("https://cdn.example.test/remoteEntry.aaa.js");
      expect(session?.runtime.plugins?.auth?.ui?.entryUrl).toBe(
        "https://cdn.example.test/remoteEntry.aaa.js",
      );
      expect(session?.runtime.plugins?.auth?.ui?.source).toBe("remote");
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

      const local = await readAuthoredConfigInput(childDir);
      const resolved = await openResolution({ cwd: childDir });

      expect(local?.app?.host).toBeUndefined();
      expect(local?.app?.auth).toBeUndefined();
      expect(resolved?.config.app.host.production).toBe("https://host.parent.dev");
      expect(resolved?.config.app.auth?.production).toBe("https://auth.parent.dev");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
