import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRuntimeConfig, buildRuntimePluginsForConfig } from "../../src/config";
import type { BosConfig, BosEnv } from "../../src/types";

function writeJson(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function makeBosConfig(overrides: Partial<BosConfig> = {}): BosConfig {
  return {
    account: "test.near",
    domain: "test.dev",
    app: {
      host: {
        development: "local:host",
        production: "https://host.test.dev",
      },
      ui: {
        name: "ui",
        development: "local:ui",
        production: "https://ui.test.dev",
      },
      api: {
        name: "api",
        development: "local:api",
        production: "https://api.test.dev",
      },
    },
    ...overrides,
  } as BosConfig;
}

describe("plugin UI runtime config", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProjectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "plugin-ui-runtime-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "host"), { recursive: true });
    mkdirSync(join(dir, "ui"), { recursive: true });
    mkdirSync(join(dir, "api"), { recursive: true });
    return dir;
  }

  it("resolves plugin metadata from a local provider config", async () => {
    const baseDir = makeProjectDir();
    mkdirSync(join(baseDir, "plugins/apps/ui"), { recursive: true });
    writeJson(join(baseDir, "plugins/apps/bos.config.json"), {
      plugins: {
        apps: {
          name: "apps",
          development: "local:.",
          production: "https://apps.test.dev",
        },
      },
      app: {
        ui: {
          name: "apps-ui",
          development: "local:./ui",
          production: "https://apps-ui.test.dev",
        },
      },
    });

    const config = makeBosConfig({
      plugins: {
        apps: {
          development: "local:plugins/apps",
        } as any,
      },
    });

    const pluginRuntime = await buildRuntimePluginsForConfig(
      config,
      baseDir,
      "development" as BosEnv,
    );
    const runtime = await buildRuntimeConfig(config, baseDir, "development" as BosEnv, {
      plugins: pluginRuntime,
    });

    expect(runtime.plugins?.apps).toBeDefined();
    expect(runtime.plugins?.apps.name).toBe("apps");
    expect(runtime.plugins?.apps.ui?.name).toBe("apps-ui");
    expect(runtime.plugins?.apps.ui?.source).toBe("local");
  });

  it("resolves targeted extends paths strictly", async () => {
    const baseDir = makeProjectDir();
    const providerConfigPath = join(baseDir, "providers/example.bos.config.json");
    writeJson(providerConfigPath, {
      app: {
        api: {
          name: "demo-api",
          production: "https://demo-api.test.dev",
        },
      },
      plugins: {
        apps: {
          name: "isolated-apps",
          production: "https://isolated-apps.test.dev",
          routes: ["ui/src/routes/_layout/apps/**"],
        },
      },
    });

    const config = makeBosConfig({
      plugins: {
        apps: {
          extends: `${providerConfigPath}#plugins.apps`,
        } as any,
      },
    });

    const pluginRuntime = await buildRuntimePluginsForConfig(
      config,
      baseDir,
      "production" as BosEnv,
    );

    expect(pluginRuntime?.apps.name).toBe("isolated-apps");
    expect(pluginRuntime?.apps.url).toBe("https://isolated-apps.test.dev");
    expect(pluginRuntime?.apps.routes).toEqual(["ui/src/routes/_layout/apps/**"]);
  });

  it("does not resolve remote local targets against the consumer root", async () => {
    const baseDir = makeProjectDir();
    const providerConfigPath = join(baseDir, "providers/example.bos.config.json");
    writeJson(providerConfigPath, {
      plugins: {
        apps: {
          name: "apps",
          development: "local:.",
          production: "https://apps.test.dev",
        },
      },
    });

    const config = makeBosConfig({
      plugins: {
        apps: {
          extends: `${providerConfigPath}#plugins.apps`,
        } as any,
      },
    });

    const pluginRuntime = await buildRuntimePluginsForConfig(
      config,
      baseDir,
      "development" as BosEnv,
    );

    expect(pluginRuntime?.apps.source).toBe("remote");
    expect(pluginRuntime?.apps.url).toBe("https://apps.test.dev");
    expect(pluginRuntime?.apps.localPath).toBeUndefined();
  });
});
