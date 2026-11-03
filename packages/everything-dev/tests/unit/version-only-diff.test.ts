import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../../../scripts/version-only-diff.mjs");
const dirs: string[] = [];

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "version-diff-"));
  dirs.push(dir);
  const run = (args: string[]) =>
    new Promise<void>((resolve, reject) => {
      execFile("git", args, { cwd: dir }, (error) => (error ? reject(error) : resolve()));
    });
  return Object.assign(run, { dir });
}

async function commitAll(repo: ReturnType<typeof fixtureRepo>, message: string): Promise<string> {
  await repo(["add", "-A"]);
  await repo(["-c", "user.email=fixture@test", "-c", "user.name=fixture", "commit", "-m", message]);
  return (await gitSha(repo))!;
}

async function gitSha(repo: ReturnType<typeof fixtureRepo>): Promise<string | undefined> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: repo.dir }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim()),
    );
  });
  return output;
}

type Output = { code: number | null; stdout: string; stderr: string };

async function runDiff(
  repo: ReturnType<typeof fixtureRepo>,
  base: string,
  head: string,
): Promise<Output> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, base, head],
      {
        cwd: repo.dir,
        env: { ...process.env, VERSION_DIFF_REPO_ROOT: repo.dir },
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const code = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("version-only-diff", () => {
  it("accepts a pure version-bump diff (changesets version output shape)", async () => {
    const repo = fixtureRepo();
    await repo(["init", "-q"]);
    await repo(["checkout", "-qb", "main"]);
    mkdirSync(join(repo.dir, "packages/everything-dev"), { recursive: true });
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.29" }, null, 2),
    );
    const base = await commitAll(repo, "base");
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.30" }, null, 2),
    );
    await repo(["add", "-A"]);
    const head = await commitAll(repo, "version bump");
    const out = await runDiff(repo, base, head);
    expect(out.code).toBe(0);
  });

  it("refuses a hand-edited dependency change so the full suite runs", async () => {
    const repo = fixtureRepo();
    await repo(["init", "-q"]);
    await repo(["checkout", "-qb", "main"]);
    mkdirSync(join(repo.dir, "packages/everything-dev"), { recursive: true });
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.29" }, null, 2),
    );
    const base = await commitAll(repo, "base");
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify(
        { name: "everything-dev", version: "2.0.0-rc.30", devDependencies: { leftpad: "^1.3.0" } },
        null,
        2,
      ),
    );
    const head = await commitAll(repo, "hand dep edit");
    const out = await runDiff(repo, base, head);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("package.json lines that are not version");
  });

  it("refuses any file outside the release-mechanical allowlist", async () => {
    const repo = fixtureRepo();
    await repo(["init", "-q"]);
    await repo(["checkout", "-qb", "main"]);
    mkdirSync(join(repo.dir, "packages/everything-dev"), { recursive: true });
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.29" }, null, 2),
    );
    const base = await commitAll(repo, "base");
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.30" }, null, 2),
    );
    mkdirSync(join(repo.dir, "scripts"), { recursive: true });
    writeFileSync(join(repo.dir, "scripts/stray.mjs"), "console.log('code change')\n");
    const head = await commitAll(repo, "sneaked code change");
    const out = await runDiff(repo, base, head);
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain("files outside the release-mechanical allowlist");
    expect(out.stderr).toContain("scripts/stray.mjs");
  });

  it("accepts changelog and .changeset churn from the release train", async () => {
    const repo = fixtureRepo();
    await repo(["init", "-q"]);
    await repo(["checkout", "-qb", "main"]);
    mkdirSync(join(repo.dir, "packages/everything-dev"), { recursive: true });
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.29" }, null, 2),
    );
    const base = await commitAll(repo, "base");
    writeFileSync(
      join(repo.dir, "packages/everything-dev/package.json"),
      JSON.stringify({ name: "everything-dev", version: "2.0.0-rc.30" }, null, 2),
    );
    writeFileSync(join(repo.dir, "packages/everything-dev/CHANGELOG.md"), "# v2.0.0-rc.30\n");
    mkdirSync(join(repo.dir, ".changeset"), { recursive: true });
    writeFileSync(join(repo.dir, ".changeset/pre.json"), JSON.stringify({ mode: "pre" }));
    rmSync(join(repo.dir, ".changeset/taken-changeset.md"), { force: true });
    const head = await commitAll(repo, "release churn");
    const out = await runDiff(repo, base, head);
    expect(out.code).toBe(0);
  });
});
