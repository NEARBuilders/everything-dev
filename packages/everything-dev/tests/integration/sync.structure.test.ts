import { describe, expect, it } from "vitest";
import { isFrameworkOwnedSyncFile, mergePackageJson } from "../../src/cli/sync";

describe("bos sync — framework-owned files", () => {
  it("marks scaffold runtime files as framework-owned", () => {
    expect(isFrameworkOwnedSyncFile(".gitignore")).toBe(true);
    expect(isFrameworkOwnedSyncFile("biome.json")).toBe(true);
    expect(isFrameworkOwnedSyncFile("CONTRIBUTING.md")).toBe(true);
    expect(isFrameworkOwnedSyncFile(".github/workflows/release.yml")).toBe(true);
    expect(isFrameworkOwnedSyncFile("ui/src/globals.d.ts")).toBe(true);
    expect(isFrameworkOwnedSyncFile("ui/src/router.tsx")).toBe(true);
    expect(isFrameworkOwnedSyncFile("api/rspack.config.js")).toBe(true);
  });

  it("does not mark app-owned files as framework-owned", () => {
    expect(isFrameworkOwnedSyncFile("Dockerfile")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/routes/_layout/index.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/components/user-nav.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("api/src/index.ts")).toBe(false);
  });
});

describe("bos sync — package.json merge", () => {
  it("preserves local root identity while applying scaffold-owned fields", () => {
    const merged = mergePackageJson(
      "package.json",
      {
        name: "my-app",
        private: true,
        scripts: {
          dev: "custom dev",
          custom: "custom script",
        },
        dependencies: {
          foo: "1.0.0",
          "everything-dev": "^0.1.0",
        },
        workspaces: {
          packages: ["custom"],
          catalog: {
            foo: "^1.0.0",
            "everything-dev": "^0.1.0",
          },
        },
      },
      {
        name: "monorepo",
        scripts: {
          dev: "node_modules/.bin/bos dev",
          build: "node_modules/.bin/bos build",
        },
        dependencies: {
          "everything-dev": "catalog:",
        },
        workspaces: {
          packages: ["ui", "api"],
          catalog: {
            "everything-dev": "^1.2.3",
          },
        },
      },
    ) as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      workspaces: { packages: string[]; catalog: Record<string, string> };
    };

    expect(merged.name).toBe("my-app");
    expect(merged.scripts.dev).toBe("node_modules/.bin/bos dev");
    expect(merged.scripts.build).toBe("node_modules/.bin/bos build");
    expect(merged.scripts.custom).toBe("custom script");
    expect(merged.dependencies.foo).toBe("1.0.0");
    expect(merged.dependencies["everything-dev"]).toBe("catalog:");
    expect(merged.workspaces.packages).toEqual(["ui", "api", "custom"]);
    expect(merged.workspaces.catalog.foo).toBe("^1.0.0");
    expect(merged.workspaces.catalog["everything-dev"]).toBe("^1.2.3");
  });

  it("preserves custom workspace package data while overwriting scaffold entries", () => {
    const merged = mergePackageJson(
      "ui/package.json",
      {
        version: "9.9.9",
        scripts: {
          build: "custom build",
          storybook: "storybook dev",
        },
        devDependencies: {
          custom: "1.0.0",
          "everything-dev": "^0.1.0",
        },
      },
      {
        version: "1.2.3",
        scripts: {
          build: "bun run build:client && bun run build:ssr",
        },
        devDependencies: {
          "everything-dev": "catalog:",
          vitest: "catalog:",
        },
      },
    ) as {
      version: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(merged.version).toBe("9.9.9");
    expect(merged.scripts.build).toBe("bun run build:client && bun run build:ssr");
    expect(merged.scripts.storybook).toBe("storybook dev");
    expect(merged.devDependencies.custom).toBe("1.0.0");
    expect(merged.devDependencies["everything-dev"]).toBe("catalog:");
    expect(merged.devDependencies.vitest).toBe("catalog:");
  });
});
