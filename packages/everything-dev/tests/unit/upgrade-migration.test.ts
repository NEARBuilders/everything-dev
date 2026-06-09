import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as initModule from "../../src/cli/init";
import * as syncModule from "../../src/cli/sync";
import {
  migrateBosConfigFiles,
  migrateChildRootPackageJson,
  upgradeTemplate,
} from "../../src/cli/upgrade";
import * as sharedDepsModule from "../../src/shared-deps";

describe("upgrade bos config migration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeProjectDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "upgrade-migration-"));
    tempDirs.push(dir);
    mkdirSync(join(dir, "plugins/projects"), { recursive: true });
    return dir;
  }

  it("rewrites extends targets with #path and merges plugin config into root", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "test.near",
          app: {
            host: { development: "local:host", production: "https://host.test.dev" },
            ui: { name: "ui", development: "local:ui", production: "https://ui.test.dev" },
            api: { name: "api", development: "local:api", production: "https://api.test.dev" },
            auth: { extends: "bos://auth.everything.near/auth.everything.dev" },
          },
          plugins: {
            projects: {
              extends: "bos://dev.everything.near/projects.everything.dev",
              development: "local:plugins/projects",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "plugins/projects/bos.config.json"),
      `${JSON.stringify(
        {
          domain: "projects.everything.dev",
          app: {
            api: {
              development: "local:.",
              production: "https://projects.test.dev",
              secrets: ["PROJECTS_DATABASE_URL"],
            },
          },
          sidebar: [{ icon: "FolderKanban", label: "projects" }],
          routes: ["ui/src/routes/_layout/_authenticated/projects/**"],
        },
        null,
        2,
      )}\n`,
    );

    const migrated = await migrateBosConfigFiles(projectDir);

    expect(migrated).toContain("bos.config.json");
    expect(migrated).toContain("plugins/projects/bos.config.json");
    expect(existsSync(join(projectDir, "plugins/projects/bos.config.json"))).toBe(false);

    const rootConfig = JSON.parse(readFileSync(join(projectDir, "bos.config.json"), "utf-8")) as {
      app: { auth: { extends: string } };
      plugins: {
        projects: {
          extends?: string;
          development: string;
          production?: string;
          secrets?: string[];
          sidebar?: Array<{ icon: string; label: string }>;
          routes?: string[];
        };
      };
    };

    expect(rootConfig.app.auth.extends).toBe(
      "bos://auth.everything.near/auth.everything.dev#app.auth",
    );

    expect(rootConfig.plugins.projects.development).toBe("local:plugins/projects");
    expect(rootConfig.plugins.projects.production).toBe("https://projects.test.dev");
    expect(rootConfig.plugins.projects.secrets).toEqual(["PROJECTS_DATABASE_URL"]);
    expect(rootConfig.plugins.projects.sidebar).toEqual([
      { icon: "FolderKanban", label: "projects" },
    ]);
    expect(rootConfig.plugins.projects.routes).toEqual([
      "ui/src/routes/_layout/_authenticated/projects/**",
    ]);
  });

  it("removes extends from self-owned local plugins", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "test.near",
          app: {
            host: { development: "local:host", production: "https://host.test.dev" },
            ui: { name: "ui", development: "local:ui", production: "https://ui.test.dev" },
            api: { name: "api", development: "local:api", production: "https://api.test.dev" },
          },
          plugins: {
            projects: {
              extends: "bos://dev.everything.near/projects.everything.dev#plugins.projects",
              development: "local:plugins/projects",
              secrets: ["PROJECTS_DATABASE_URL"],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    mkdirSync(join(projectDir, "plugins/projects"), { recursive: true });
    writeFileSync(
      join(projectDir, "plugins/projects/bos.config.json"),
      `${JSON.stringify(
        {
          domain: "projects.everything.dev",
          plugins: {
            projects: {
              name: "projects",
              development: "local:.",
              production: "https://projects.test.dev",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await migrateBosConfigFiles(projectDir);

    const rootConfig = JSON.parse(readFileSync(join(projectDir, "bos.config.json"), "utf-8")) as {
      plugins: {
        projects: {
          extends?: string;
          name?: string;
          development: string;
          production?: string;
        };
      };
    };

    expect(rootConfig.plugins.projects.extends).toBeUndefined();
    expect(rootConfig.plugins.projects.name).toBeUndefined();
    expect(rootConfig.plugins.projects.development).toBe("local:plugins/projects");
    expect(rootConfig.plugins.projects.production).toBe("https://projects.test.dev");
  });

  it("removes name from plugin entries", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "test.near",
          app: {
            host: { development: "local:host" },
            ui: { name: "ui", development: "local:ui" },
            api: { name: "api", development: "local:api" },
          },
          plugins: {
            projects: {
              name: "projects",
              development: "local:plugins/projects",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await migrateBosConfigFiles(projectDir);

    const rootConfig = JSON.parse(readFileSync(join(projectDir, "bos.config.json"), "utf-8")) as {
      plugins: { projects: { name?: string; development: string } };
    };

    expect(rootConfig.plugins.projects.name).toBeUndefined();
    expect(rootConfig.plugins.projects.development).toBe("local:plugins/projects");
  });

  it("merges top-level sidebar and routes from plugin config into root entry", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "test.near",
          app: {
            host: { development: "local:host" },
            ui: { name: "ui", development: "local:ui" },
            api: { name: "api", development: "local:api" },
          },
          plugins: {
            apps: {
              development: "local:plugins/apps",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    mkdirSync(join(projectDir, "plugins/apps"), { recursive: true });
    writeFileSync(
      join(projectDir, "plugins/apps/bos.config.json"),
      `${JSON.stringify(
        {
          domain: "apps.everything.dev",
          sidebar: [{ icon: "Globe", label: "apps", roleRequired: "anon" }],
          routes: ["ui/src/routes/_layout/apps/**"],
        },
        null,
        2,
      )}\n`,
    );

    await migrateBosConfigFiles(projectDir);

    expect(existsSync(join(projectDir, "plugins/apps/bos.config.json"))).toBe(false);

    const rootConfig = JSON.parse(readFileSync(join(projectDir, "bos.config.json"), "utf-8")) as {
      plugins: {
        apps: {
          development: string;
          sidebar?: unknown;
          routes?: unknown;
        };
      };
    };

    expect(rootConfig.plugins.apps.sidebar).toEqual([
      { icon: "Globe", label: "apps", roleRequired: "anon" },
    ]);
    expect(rootConfig.plugins.apps.routes).toEqual(["ui/src/routes/_layout/apps/**"]);
  });

  it("deletes plugin bos.config.json files even when no metadata to merge", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          account: "test.near",
          app: {
            host: { development: "local:host" },
            ui: { name: "ui", development: "local:ui" },
            api: { name: "api", development: "local:api" },
          },
          plugins: {
            projects: {
              development: "local:plugins/projects",
              secrets: ["PROJECTS_DATABASE_URL"],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    mkdirSync(join(projectDir, "plugins/projects"), { recursive: true });
    writeFileSync(
      join(projectDir, "plugins/projects/bos.config.json"),
      `${JSON.stringify(
        {
          domain: "projects.everything.dev",
          plugins: {
            projects: {
              name: "projects",
              development: "local:.",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const migrated = await migrateBosConfigFiles(projectDir);

    expect(migrated).toContain("plugins/projects/bos.config.json");
    expect(existsSync(join(projectDir, "plugins/projects/bos.config.json"))).toBe(false);
  });

  it("removes legacy child workflow and framework package wiring from root package.json", async () => {
    const projectDir = makeProjectDir();
    mkdirSync(join(projectDir, "ui"), { recursive: true });
    writeFileSync(join(projectDir, "ui", "package.json"), '{"name":"ui"}\n');

    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          extends: "bos://dev.everything.near/everything.dev",
          account: "test.near",
          domain: "test.dev",
          app: {
            ui: { development: "local:ui" },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          scripts: {
            version: "changeset version && bun run sync-catalog",
            "sync-catalog": "bun scripts/sync-catalog-versions.ts",
            typecheck:
              "bun run types:gen && bun run --cwd packages/everything-dev typecheck & bun run --cwd ui tsc --noEmit & wait",
          },
          module: "index.ts",
          peerDependencies: {
            typescript: "^5",
          },
          overrides: {
            "everything-dev": "file:packages/everything-dev",
            "every-plugin": "file:packages/every-plugin",
          },
          workspaces: {
            packages: ["ui", "packages/everything-dev", "packages/every-plugin"],
          },
        },
        null,
        2,
      )}\n`,
    );

    const changed = await migrateChildRootPackageJson(projectDir);

    expect(changed).toBe(true);

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")) as {
      name?: string;
      private?: boolean;
      type?: string;
      module?: string;
      peerDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      overrides?: Record<string, string>;
      workspaces?: { packages?: string[] };
    };

    expect(pkg.name).toBe("monorepo");
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe("module");
    expect(pkg.module).toBeUndefined();
    expect(pkg.peerDependencies).toEqual({ typescript: "^5" });
    expect(pkg.scripts?.version).toBe("changeset version");
    expect(pkg.scripts?.["sync-catalog"]).toBeUndefined();
    expect(pkg.scripts?.typecheck).toBe(
      "bun run types:gen && if [ -d ui ]; then bun run --cwd ui typecheck; fi",
    );
    expect(pkg.overrides).toBeUndefined();
    expect(pkg.workspaces?.packages).toEqual(["ui"]);
  });

  it("rewrites auth-utils imports and removes the deprecated helper file during upgrade", async () => {
    const projectDir = makeProjectDir();
    mkdirSync(join(projectDir, "ui", "src", "components"), { recursive: true });
    mkdirSync(join(projectDir, "ui", "src", "lib"), { recursive: true });

    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          extends: "bos://dev.everything.near/everything.dev",
          account: "test.near",
          domain: "test.dev",
          app: {
            ui: { development: "local:ui" },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          private: true,
          workspaces: {
            packages: ["ui"],
          },
          dependencies: {
            "everything-dev": "catalog:",
            "every-plugin": "catalog:",
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "ui", "package.json"),
      `${JSON.stringify({ name: "ui" }, null, 2)}\n`,
    );

    writeFileSync(
      join(projectDir, "ui", "src", "components", "demo-sections.tsx"),
      'import { getAccountProviderId, getProviderConfig } from "@/lib/auth-utils";\n',
    );
    writeFileSync(join(projectDir, "ui", "src", "lib", "auth-utils.ts"), "export {}\n");

    vi.spyOn(initModule, "fetchParentConfig").mockResolvedValue({
      repository: "https://github.com/NEARBuilders/everything-dev",
    } as never);
    vi.spyOn(initModule, "resolveCatalogChainSource").mockResolvedValue({
      catalog: {},
      repository: "https://github.com/NEARBuilders/everything-dev",
      extendsChain: [],
    } as never);
    vi.spyOn(syncModule, "syncTemplate").mockResolvedValue({
      status: "synced",
      updated: [],
      skipped: [],
      added: [],
    } as never);
    vi.spyOn(sharedDepsModule, "syncResolvedSharedDeps").mockResolvedValue({
      mode: "bos->catalog",
      hostMode: "local",
      bosConfigChanged: false,
      catalogChanged: false,
      generatedChanged: false,
      resolved: { deps: {}, fingerprintSha256: "" },
    } as never);

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
    });

    expect(result.status).toBe("upgraded");
    expect(existsSync(join(projectDir, "ui", "src", "lib", "auth-utils.ts"))).toBe(false);

    const demoSections = readFileSync(
      join(projectDir, "ui", "src", "components", "demo-sections.tsx"),
      "utf-8",
    );
    expect(demoSections).toContain('from "@/lib/auth"');
    expect(demoSections).not.toContain("auth-utils");
  });

  it("adds @better-auth/core catalog refs to root and workspace packages during package migration", async () => {
    const projectDir = makeProjectDir();
    mkdirSync(join(projectDir, "ui"), { recursive: true });

    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          extends: "bos://dev.everything.near/everything.dev",
          account: "test.near",
          domain: "test.dev",
          app: {
            ui: { development: "local:ui" },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          dependencies: {
            "better-auth": "catalog:",
            "better-near-auth": "catalog:",
          },
          workspaces: {
            packages: ["ui"],
            catalog: {
              "better-auth": "1.6.9",
              "better-near-auth": "1.5.0",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "ui", "package.json"),
      `${JSON.stringify(
        {
          name: "ui",
          dependencies: {
            "@better-auth/api-key": "catalog:",
            "@better-auth/passkey": "catalog:",
            "better-auth": "catalog:",
          },
        },
        null,
        2,
      )}\n`,
    );

    const changed = await migrateChildRootPackageJson(projectDir);

    expect(changed).toBe(true);

    const rootPkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    const uiPkg = JSON.parse(readFileSync(join(projectDir, "ui", "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };

    expect(rootPkg.dependencies?.["@better-auth/core"]).toBe("catalog:");
    expect(uiPkg.dependencies?.["@better-auth/core"]).toBe("catalog:");
  });

  it("preserves an existing child auth override during upgrade sync", async () => {
    const projectDir = makeProjectDir();
    mkdirSync(join(projectDir, "ui"), { recursive: true });
    writeFileSync(join(projectDir, "ui", "package.json"), '{"name":"ui"}\n');

    writeFileSync(
      join(projectDir, "bos.config.json"),
      `${JSON.stringify(
        {
          extends: "bos://dev.everything.near/everything.dev",
          account: "test.near",
          domain: "test.dev",
          shared: {
            ui: {
              effect: {
                version: "3.21.0",
                requiredVersion: "^3.21.0",
                singleton: true,
                strictVersion: false,
                shareScope: "default",
              },
            },
          },
          app: {
            ui: { development: "local:ui" },
            auth: {
              development: "local:plugins/auth",
              production: "https://auth.child.dev",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(projectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          private: true,
          workspaces: {
            packages: ["ui"],
            catalog: {
              effect: "3.21.0",
              "everything-dev": "^1.28.11",
              "every-plugin": "^2.5.11",
            },
          },
          dependencies: {
            "everything-dev": "catalog:",
            "every-plugin": "catalog:",
          },
        },
        null,
        2,
      )}\n`,
    );

    vi.spyOn(initModule, "runBunInstallForUpgrade").mockResolvedValue();
    vi.spyOn(initModule, "runTypesGen").mockResolvedValue();
    vi.spyOn(syncModule, "syncTemplate").mockImplementation(async (dir, options) => {
      await initModule.personalizeConfig(dir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        overrides: ["ui"],
        workspaceOpts: { sourceDir: "/Users/elliot.braem/workspace/product/everything.dev" },
        mode: "sync",
        existingConfig: JSON.parse(readFileSync(join(dir, "bos.config.json"), "utf-8")),
      });

      return {
        status: options.dryRun ? ("dry-run" as const) : ("synced" as const),
        updated: [],
        skipped: [],
        added: [],
      };
    });

    const result = await upgradeTemplate(projectDir, {
      dryRun: false,
      noInstall: true,
      noSync: false,
    });

    expect(result.status).toBe("upgraded");

    const config = JSON.parse(readFileSync(join(projectDir, "bos.config.json"), "utf-8")) as {
      app?: { auth?: { development?: string; production?: string } };
    };

    expect(config.app?.auth).toEqual({
      development: "local:plugins/auth",
      production: "https://auth.child.dev",
    });
  });
});
