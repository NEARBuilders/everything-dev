import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageReleasePackages } from "../../src/internal/manifest-normalizer";

describe("stageReleasePackages", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves package versions in staged release manifests", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "everything-dev-release-"));
    tempDirs.push(repoRoot);

    mkdirSync(join(repoRoot, "packages", "everything-dev"), { recursive: true });
    mkdirSync(join(repoRoot, "packages", "every-plugin"), { recursive: true });

    writeFileSync(
      join(repoRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          workspaces: {
            packages: ["packages/everything-dev", "packages/every-plugin"],
            catalog: {
              effect: "3.21.2",
              "every-plugin": "3.4.5",
              "everything-dev": "1.2.3",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(repoRoot, "packages", "everything-dev", "package.json"),
      `${JSON.stringify(
        {
          name: "everything-dev",
          version: "1.2.3",
          dependencies: {
            "every-plugin": "workspace:*",
            effect: "catalog:",
          },
          scripts: {
            build: "tsdown",
            prepare: "echo prepare",
          },
          workspaces: {
            packages: ["src"],
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(repoRoot, "packages", "every-plugin", "package.json"),
      `${JSON.stringify(
        {
          name: "every-plugin",
          version: "3.4.5",
        },
        null,
        2,
      )}\n`,
    );

    const outDir = join(repoRoot, ".release");
    stageReleasePackages({ repoRoot, outDir, packageNames: ["everything-dev"] });

    const staged = JSON.parse(
      readFileSync(join(outDir, "everything-dev", "package.json"), "utf-8"),
    ) as {
      version?: string;
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
      workspaces?: unknown;
    };

    expect(staged.version).toBe("1.2.3");
    expect(staged.dependencies?.["every-plugin"]).toBe("^3.4.5");
    expect(staged.dependencies?.effect).toBe("3.21.2");
    expect(staged.scripts?.prepare).toBeUndefined();
    expect(staged.workspaces).toBeUndefined();
  });

  it("strips development conditions but keeps dist fallbacks in exports", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "everything-dev-release-"));
    tempDirs.push(repoRoot);

    mkdirSync(join(repoRoot, "packages", "everything-dev"), { recursive: true });
    mkdirSync(join(repoRoot, "packages", "every-plugin"), { recursive: true });

    writeFileSync(
      join(repoRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          workspaces: {
            packages: ["packages/everything-dev", "packages/every-plugin"],
            catalog: { "everything-dev": "1.2.3", "every-plugin": "3.4.5" },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(repoRoot, "packages", "everything-dev", "package.json"),
      `${JSON.stringify(
        {
          name: "everything-dev",
          version: "1.2.3",
          exports: {
            "./good": {
              development: {
                types: "./src/good.ts",
                import: "./src/good.ts",
              },
              types: "./dist/good.d.mts",
              import: "./dist/good.mjs",
              require: "./dist/good.cjs",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const outDir = join(repoRoot, ".release");
    stageReleasePackages({ repoRoot, outDir, packageNames: ["everything-dev"] });

    const staged = JSON.parse(
      readFileSync(join(outDir, "everything-dev", "package.json"), "utf-8"),
    ) as { exports?: Record<string, Record<string, unknown>> };

    expect(staged.exports?.["./good"]).toEqual({
      types: "./dist/good.d.mts",
      import: "./dist/good.mjs",
      require: "./dist/good.cjs",
    });
  });

  it("fails the release when an export still points at ./src/ after stripping", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "everything-dev-release-"));
    tempDirs.push(repoRoot);

    mkdirSync(join(repoRoot, "packages", "everything-dev"), { recursive: true });
    mkdirSync(join(repoRoot, "packages", "every-plugin"), { recursive: true });

    writeFileSync(
      join(repoRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "monorepo",
          workspaces: {
            packages: ["packages/everything-dev", "packages/every-plugin"],
            catalog: { "everything-dev": "1.2.3", "every-plugin": "3.4.5" },
          },
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      join(repoRoot, "packages", "everything-dev", "package.json"),
      `${JSON.stringify(
        {
          name: "everything-dev",
          version: "1.2.3",
          exports: {
            "./good": {
              development: { types: "./src/good.ts", import: "./src/good.ts" },
              types: "./dist/good.d.mts",
              import: "./dist/good.mjs",
            },
            "./bad": {
              types: "./src/bad.ts",
              import: "./src/bad.ts",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(() =>
      stageReleasePackages({
        repoRoot,
        outDir: join(repoRoot, ".release"),
        packageNames: ["everything-dev"],
      }),
    ).toThrowError(/\.\/bad[\s\S]*\.\/src\/bad\.ts/);
  });
});
