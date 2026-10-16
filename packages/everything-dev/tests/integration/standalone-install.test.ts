import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, it } from "vitest";
import { getFrameworkTarballs } from "./framework-packages";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

// The gate #365 asked for: everything-dev packed exactly as npm consumers
// receive it (no workspace overrides, no tarball rewrites) must install and
// import standalone — rc.5–rc.8 failed here on a leaked `workspace:^` dep.
describe.skipIf(process.env.CI !== "true")("standalone npm install gate", () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), "bos-standalone-"));
    writeFileSync(
      join(projectDir, "package.json"),
      `${JSON.stringify({ name: "standalone-gate", private: true })}\n`,
    );
  }, 180_000);

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  }, 120_000);

  it("installs the packed everything-dev tarball in an empty project and imports", async () => {
    const tarballs = await getFrameworkTarballs(REPO_ROOT);

    await execa("pnpm", ["add", tarballs["everything-dev"]], { cwd: projectDir });

    await execa(
      "node",
      [
        "--input-type=module",
        "--eval",
        `import("everything-dev/ui/manifest").then((m) => { if (typeof m.constructTree !== "function") throw new Error("missing export"); })`,
      ],
      { cwd: projectDir },
    );
  }, 300_000);
});
