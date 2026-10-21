import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAMEWORK_OWNED_HEADER,
  FRAMEWORK_OWNED_SYNC_FILES,
  frameworkOwnedHeaderComment,
  isFrameworkOwnedSyncFile,
  mergePackageJson,
  RETIRED_SYNC_FILES,
} from "../../src/cli/sync";
import {
  composePlatformReleaseManifest,
  computeTemplateInventory,
  PlatformReleaseManifestSchema,
  serializePlatformReleaseManifest,
} from "../../src/services/platform/manifest";

describe("bos sync — framework-owned files", () => {
  it("marks scaffold runtime files as framework-owned", () => {
    expect(isFrameworkOwnedSyncFile(".gitignore")).toBe(true);
    expect(isFrameworkOwnedSyncFile("biome.json")).toBe(true);
    expect(isFrameworkOwnedSyncFile(".github/workflows/deploy.yml")).toBe(true);
    expect(isFrameworkOwnedSyncFile("api/rspack.config.js")).toBe(true);
  });

  it("no longer owns any ui source file — the app owns its ui after init (ADR 0023)", () => {
    expect(isFrameworkOwnedSyncFile("ui/src/router.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/app.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/lib/api.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/lib/auth.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/routes/__root.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/providers/index.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/hooks/index.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/components/root-error.tsx")).toBe(false);
    // config-level ui files stay framework-owned
    expect(isFrameworkOwnedSyncFile("ui/tsconfig.json")).toBe(true);
    expect(isFrameworkOwnedSyncFile("ui/package.json")).toBe(true);
  });

  it("no longer owns the generated bootstrap stubs", () => {
    expect(isFrameworkOwnedSyncFile("ui/src/entry.gen.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/hydrate.gen.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/router.server.gen.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/compose.gen.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/globals.gen.ts")).toBe(false);
  });

  it("retires exactly the stub files the generated set replaced", () => {
    expect([...RETIRED_SYNC_FILES].sort()).toEqual([
      "ui/src/compose.ts",
      "ui/src/entry.ts",
      "ui/src/globals.d.ts",
      "ui/src/hydrate.tsx",
      "ui/src/router.server.tsx",
    ]);
  });

  it("no longer owns the db files or the request-context schema (ADR 0033)", () => {
    expect(isFrameworkOwnedSyncFile("api/src/db/layer.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("api/src/db/index.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("api/src/db/migrate.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/db/layer.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/db/migrate.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/lib/context.ts")).toBe(false);
    // the drizzle-kit config stays owned: identity-driven wiring carrying
    // journal policy, zero app decisions
    expect(isFrameworkOwnedSyncFile("api/drizzle.config.ts")).toBe(true);
    expect(isFrameworkOwnedSyncFile("plugins/apps/drizzle.config.ts")).toBe(true);
  });

  it("marks per-plugin plumbing files as framework-owned", () => {
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/global.d.ts")).toBe(true);
    expect(isFrameworkOwnedSyncFile("plugins/apps/tests/types.d.ts")).toBe(true);
  });

  it("marks agent workflow skills and docs as framework-owned", () => {
    expect(isFrameworkOwnedSyncFile(".agents/skills/implement/SKILL.md")).toBe(true);
    expect(isFrameworkOwnedSyncFile(".agents/skills/everything-dev-app/SKILL.md")).toBe(true);
    expect(isFrameworkOwnedSyncFile(".agents/skills/tdd/agents/openai.yaml")).toBe(true);
    expect(isFrameworkOwnedSyncFile("docs/agents/issue-tracker.md")).toBe(true);
    expect(isFrameworkOwnedSyncFile("skills-lock.json")).toBe(true);
  });

  it("does not mark app-owned files as framework-owned", () => {
    expect(isFrameworkOwnedSyncFile("Dockerfile")).toBe(false);
    expect(isFrameworkOwnedSyncFile(".github/renovate.json")).toBe(false);
    expect(isFrameworkOwnedSyncFile(".opencode/skills/everything-dev/SKILL.md")).toBe(false);
    expect(isFrameworkOwnedSyncFile("docs/custom-note.md")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/routes/_layout/_public/index.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("ui/src/components/user-nav.tsx")).toBe(false);
    expect(isFrameworkOwnedSyncFile("api/src/index.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("api/src/lib/auth.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/index.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/lib/auth.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/lib/auth-types.gen.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/service.ts")).toBe(false);
    expect(isFrameworkOwnedSyncFile("plugins/apps/src/lib/other.ts")).toBe(false);
  });
});

describe("framework-owned marker guardrail (ADR 0032)", () => {
  const REPO_ROOT = join(import.meta.dirname, "../../../../");

  function trackedFiles(): string[] {
    // Tracked + untracked-but-not-ignored: a brand-new file must be scanned
    // locally too, not only after it is committed (the CI trap).
    return execSync("git ls-files --cached --others --exclude-standard", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    })
      .split("\n")
      .filter(Boolean);
  }

  function fileStartsWithMarker(file: string): boolean {
    try {
      const content = readFileSync(join(REPO_ROOT, file), "utf-8");
      return (
        content.startsWith("/**\n * FRAMEWORK-OWNED") ||
        content.startsWith("# FRAMEWORK-OWNED") ||
        content.startsWith("<!--\nFRAMEWORK-OWNED")
      );
    } catch {
      return false;
    }
  }

  it("every file carrying the marker is in the ownership inventory", () => {
    const offenders = trackedFiles().filter(
      (file) => fileStartsWithMarker(file) && !isFrameworkOwnedSyncFile(file),
    );
    expect(offenders).toEqual([]);
  });

  it("no stale warning headers remain in template or source files", () => {
    const staleNeedle = ["BE CAREFUL", "MODIFYING"].join(" ");
    const offenders = trackedFiles().filter((file) => {
      // Dated records — historical ADRs and plans may quote the retired
      // header verbatim (the same exclusion docs-link-check applies to
      // ADR bodies), and CHANGELOG.md is historical by convention.
      if (
        file.endsWith("CHANGELOG.md") ||
        file.startsWith("docs/plans/") ||
        file.startsWith("docs/adr/")
      )
        return false;
      try {
        return readFileSync(join(REPO_ROOT, file), "utf-8").includes(staleNeedle);
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });

  it("the canonical header text is defined once in ownership.ts", () => {
    const ownership = readFileSync(
      join(REPO_ROOT, "packages/everything-dev/src/services/scaffold/ownership.ts"),
      "utf-8",
    );
    for (const line of FRAMEWORK_OWNED_HEADER.split("\n")) {
      expect(ownership).toContain(line);
      expect(frameworkOwnedHeaderComment("block")).toContain(line);
      expect(frameworkOwnedHeaderComment("hash")).toContain(line);
    }
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

  it("filters root package scripts to the child script set when provided", () => {
    const childScripts = {
      dev: "bos dev",
      build: "bos build",
      typecheck: "bun run types:gen && bun run --cwd api typecheck",
    };
    const merged = mergePackageJson(
      "package.json",
      {
        name: "my-app",
        private: true,
        scripts: {
          dev: "custom dev",
          custom: "custom script",
        },
      },
      {
        name: "monorepo",
        scripts: {
          dev: "node_modules/.bin/bos dev",
          build: "node_modules/.bin/bos build",
          "regression:start:backcompat": "bos dev --ui remote --api remote",
          "test:regression:backcompat": "bun run test:regression:http:backcompat",
        },
      },
      childScripts,
    ) as {
      name: string;
      scripts: Record<string, string>;
    };

    expect(merged.name).toBe("my-app");
    expect(merged.scripts.dev).toBe("bos dev");
    expect(merged.scripts.build).toBe("bos build");
    expect(merged.scripts.typecheck).toBe("bun run types:gen && bun run --cwd api typecheck");
    expect(merged.scripts.custom).toBe("custom script");
    expect(merged.scripts["regression:start:backcompat"]).toBeUndefined();
    expect(merged.scripts["test:regression:backcompat"]).toBeUndefined();
  });

  it("ignores childScripts for non-root package.json", () => {
    const childScripts = { dev: "bos dev" };
    const merged = mergePackageJson(
      "ui/package.json",
      { name: "ui", scripts: { build: "custom build" } },
      { name: "ui", scripts: { build: "bun run build:client" } },
      childScripts,
    ) as {
      scripts: Record<string, string>;
    };

    expect(merged.scripts.build).toBe("bun run build:client");
    expect(merged.scripts.dev).toBeUndefined();
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

describe("platform release manifest guardrail (ADR 0034)", () => {
  const REPO_ROOT = join(import.meta.dirname, "../../../..");

  it("every existing inventory path appears in the release templateInventory — and vice versa", () => {
    const inventory = computeTemplateInventory(REPO_ROOT);
    const paths = new Set(inventory.map((entry) => entry.path));
    for (const owned of FRAMEWORK_OWNED_SYNC_FILES) {
      if (existsSync(join(REPO_ROOT, owned))) {
        expect(paths.has(owned), `inventory missing framework-owned path: ${owned}`).toBe(true);
      }
    }
    const templateScaffold = new Set([
      "plugins/_template/rspack.config.js",
      "plugins/_template/tsconfig.json",
      "plugins/_template/tests/types.d.ts",
    ]);
    for (const entry of inventory) {
      expect(
        isFrameworkOwnedSyncFile(entry.path) || templateScaffold.has(entry.path),
        `inventory carries a non-framework-owned path: ${entry.path}`,
      ).toBe(true);
    }
  });

  it("a composed manifest parses back through the published schema with that inventory", () => {
    const manifest = composePlatformReleaseManifest({
      frameworkVersion: "0.0.0-test",
      everyPluginVersion: "0.0.0-test",
      imageRef: "ghcr.io/nearbuilders/everything-dev",
      catalog: {},
      templateInventory: computeTemplateInventory(REPO_ROOT),
      compatMinChild: "0.0.0-test",
    });
    const parsed = PlatformReleaseManifestSchema.parse(
      JSON.parse(serializePlatformReleaseManifest(manifest)),
    );
    expect(parsed.templateInventory.length).toBeGreaterThan(0);
  });
});
