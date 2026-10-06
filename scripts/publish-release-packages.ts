#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { globSync } from "glob";

const rootDir = join(import.meta.dirname, "..");

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: "inherit", cwd: rootDir });
}

function probe(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: "ignore", cwd: rootDir }).status === 0;
}

const publishablePackages = globSync("packages/*/package.json", { cwd: rootDir, nodir: true })
  .filter((filePath) => existsSync(join(rootDir, filePath)))
  .map((filePath) => {
    const pkg = JSON.parse(readFileSync(join(rootDir, filePath), "utf-8")) as {
      name?: string;
      private?: boolean;
      scripts?: { build?: string };
    };
    return { filePath, pkg };
  })
  .filter(({ pkg }) => pkg.private !== true && Boolean(pkg.scripts?.build));

for (const { filePath, pkg } of publishablePackages) {
  run("pnpm", ["--filter", pkg.name ?? basename(join(rootDir, filePath, "..")), "run", "build"]);
}

run("node", ["--import", "tsx", "scripts/stage-release-packages.ts"]);

const preJsonPath = join(rootDir, ".changeset", "pre.json");
const distTagArgs: string[] = [];
if (existsSync(preJsonPath)) {
  const pre = JSON.parse(readFileSync(preJsonPath, "utf-8")) as { mode?: string; tag?: string };
  if (pre.mode === "pre") {
    const tag = pre.tag ?? "rc";
    distTagArgs.push("--tag", tag);
    console.log(`Prerelease mode active: publishing under dist-tag '${tag}'`);
  }
}

const releaseDirs = globSync(".release/*/package.json", { cwd: rootDir, nodir: true }).map(
  (filePath) => join(rootDir, filePath, ".."),
);

let published = 0;
for (const dir of releaseDirs) {
  const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    name: string;
    version: string;
  };

  if (probe("npm", ["view", `${name}@${version}`, "version"])) {
    console.log(`${name}@${version} already published, skipping`);
    continue;
  }

  run("npm", ["publish", "--provenance", "--access", "public", ...distTagArgs, dir]);
  published += 1;
}

const releaseCommit =
  process.env.RELEASE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf-8" }).trim();

function extractChangelogNotes(changelogPath: string, version: string): string | null {
  if (!existsSync(changelogPath)) return null;
  const lines = readFileSync(changelogPath, "utf-8").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return null;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## \d/.test(lines[i])) break;
    body.push(lines[i]);
  }
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  return body.length > 0 ? body.join("\n") : null;
}

for (const dir of releaseDirs) {
  const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    name: string;
    version: string;
  };
  const tag = `${name}@${version}`;

  if (probe("gh", ["release", "view", tag])) {
    console.log(`Release ${tag} already exists, skipping`);
    continue;
  }

  const notes = extractChangelogNotes(join(dir, "CHANGELOG.md"), version) ?? `Release ${tag}`;
  const args = [
    "release",
    "create",
    tag,
    "--title",
    tag,
    "--notes",
    notes,
    "--target",
    releaseCommit,
  ];
  if (version.includes("-")) args.push("--prerelease");
  run("gh", args);
}

console.log(`Published ${published} package(s) to npm.`);
