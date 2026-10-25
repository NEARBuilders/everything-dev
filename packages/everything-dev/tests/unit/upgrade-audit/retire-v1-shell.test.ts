import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retireV1Shell } from "../../../src/services/scaffold/upgrade-audit/steps/retire-v1-shell";

let projectDir: string;

const run = async (dryRun: boolean) => Effect.runPromise(retireV1Shell(projectDir, dryRun));

const write = async (relPath: string, content: string) => {
  const full = join(projectDir, relPath);
  await mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
  await writeFile(full, content);
};

const RSBUILD = [
  'import { defineConfig } from "@rsbuild/core";',
  'import { pluginReact } from "@rsbuild/plugin-react";',
  "",
  "export default defineConfig({",
  "  source: {",
  "    entry: {",
  '      index: "./src/hydrate.tsx",',
  "    },",
  "  },",
  "});",
  "",
].join("\n");

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-retire-shell-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("retireV1Shell", () => {
  it("rewires the rsbuild entry and exposes to the generated stubs", async () => {
    await write(
      "ui/rsbuild.config.ts",
      `${RSBUILD}const expose = { "./Hydrate": "./src/hydrate.tsx" };\n`,
    );
    const result = await run(false);
    expect(result.writes).toContain("ui/rsbuild.config.ts");
    const config = await readFile(join(projectDir, "ui/rsbuild.config.ts"), "utf-8");
    expect(config).toContain("./src/hydrate.gen.tsx");
    expect(config).not.toContain("./src/hydrate.tsx");
  });

  it("rewires the server entry and Router expose to router.server.gen.tsx", async () => {
    await write(
      "ui/rsbuild.config.ts",
      'const serverEntry = "./src/router.server.tsx";\nconst expose = { "./Router": "./src/router.server.tsx" };\n',
    );
    await run(false);
    const config = await readFile(join(projectDir, "ui/rsbuild.config.ts"), "utf-8");
    expect(config).toContain("./src/router.server.gen.tsx");
    expect(config).not.toContain("./src/router.server.tsx");
  });

  it("deletes a retired shell when the stub exists and no reference remains", async () => {
    await write("ui/rsbuild.config.ts", RSBUILD);
    await write("ui/src/hydrate.gen.tsx", "// generated stub\n");
    await write("ui/src/hydrate.tsx", "// hand-written shell\n");

    const result = await run(false);
    expect(result.deletes).toContain("ui/src/hydrate.tsx");
    await expect(readFile(join(projectDir, "ui/src/hydrate.tsx"), "utf-8")).rejects.toThrow();
  });

  it("defers retirement when the replacement stub is missing", async () => {
    await write("ui/rsbuild.config.ts", RSBUILD);
    await write("ui/src/hydrate.tsx", "// hand-written shell\n");

    const result = await run(false);
    expect(result.deletes).not.toContain("ui/src/hydrate.tsx");
    expect(result.notes.join("\n")).toMatch(
      /replacement ui\/src\/hydrate\.gen\.tsx not generated yet/,
    );
  });

  it("defers retirement when the config still references the shell in an unrehashed form", async () => {
    await write("ui/src/hydrate.gen.tsx", "// generated stub\n");
    await write("ui/src/hydrate.tsx", "// hand-written shell\n");
    // A spelling the rewiring pass does not cover — the basename guard must defer.
    await write("ui/rsbuild.config.ts", 'const keep = "hydrate.tsx";\n');

    const result = await run(false);
    expect(result.deletes).not.toContain("ui/src/hydrate.tsx");
    expect(result.notes.join("\n")).toMatch(/still references hydrate\.tsx/);
    expect(await readFile(join(projectDir, "ui/src/hydrate.tsx"), "utf-8")).toBe(
      "// hand-written shell\n",
    );
  });

  it("dry-run writes and deletes nothing", async () => {
    await write("ui/rsbuild.config.ts", RSBUILD);
    await write("ui/src/hydrate.gen.tsx", "// generated stub\n");
    await write("ui/src/hydrate.tsx", "// hand-written shell\n");

    await run(true);
    expect(await readFile(join(projectDir, "ui/rsbuild.config.ts"), "utf-8")).toBe(RSBUILD);
    expect(await readFile(join(projectDir, "ui/src/hydrate.tsx"), "utf-8")).toBe(
      "// hand-written shell\n",
    );
  });
});
