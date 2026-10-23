#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return { filePath, pkg };
  })
  .filter(({ pkg }) => pkg.private !== true && Boolean(pkg.scripts?.build));

// Build in dependency order. The publishable packages' tsdown configs assert
// that their workspace dependencies' dist types exist at config load time
// (everything-dev's assertWorkspaceDtsDependencies), so a glob-ordered build
// can fail the whole release when a dependency-built-first ordering is not
// honored — and glob gives no such ordering. Derive a deterministic
// topological order from the workspace dependency graph instead.
const workspaceNames = new Set(
  publishablePackages.map(({ pkg }) => pkg.name).filter(Boolean) as string[],
);
const dependencyGraph = new Map<string, string[]>(
  publishablePackages.map(({ pkg }) => {
    const name = pkg.name!;
    const declared = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.devDependencies,
    };
    return [
      name,
      Object.keys(declared)
        .filter((dep) => workspaceNames.has(dep))
        .sort(),
    ];
  }),
);

function topologicalBuildOrder(graph: Map<string, string[]>): string[] {
  const remaining = new Map<string, number>(
    [...graph.entries()].map(([name, deps]) => [name, deps.length]),
  );
  const dependents = new Map<string, string[]>();
  for (const [name, deps] of graph) {
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(name);
    }
  }

  const ready = [...remaining.entries()]
    .filter(([, count]) => count === 0)
    .map(([name]) => name)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const name = ready.shift()!;
    order.push(name);
    for (const dependent of dependents.get(name) ?? []) {
      const next = remaining.get(dependent)! - 1;
      remaining.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (order.length !== graph.size) {
    const unresolved = [...graph.keys()].filter((name) => !order.includes(name));
    throw new Error(
      `dependency cycle or missing package among publishable workspaces: ${unresolved.join(", ")}`,
    );
  }
  return order;
}

const buildOrder = topologicalBuildOrder(dependencyGraph);

for (const name of buildOrder) {
  run("pnpm", ["--filter", name, "run", "build"]);
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

const releaseDirs = globSync(".release/*/package.json", { cwd: rootDir, nodir: true })
  .map((filePath) => join(rootDir, filePath, ".."))
  .map((dir) => ({
    dir,
    name: (JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { name: string }).name,
  }));
const releaseRank = new Map(buildOrder.map((name, index) => [name, index]));
releaseDirs.sort(
  (a, b) => (releaseRank.get(a.name) ?? Infinity) - (releaseRank.get(b.name) ?? Infinity),
);

let published = 0;
for (const { dir } of releaseDirs) {
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

function ensureRelease(tag: string, version: string, notes: string | null): void {
  if (probe("gh", ["release", "view", tag])) {
    console.log(`Release ${tag} already exists, skipping`);
    return;
  }

  const args = [
    "release",
    "create",
    tag,
    "--title",
    tag,
    "--notes",
    notes ?? `Release ${tag}`,
    "--target",
    releaseCommit,
  ];
  if (version.includes("-")) args.push("--prerelease");
  run("gh", args);
}

let frameworkVersion: string | undefined;

for (const { dir } of releaseDirs) {
  const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
    name: string;
    version: string;
  };
  if (name === "everything-dev") frameworkVersion = version;

  ensureRelease(
    `${name}@${version}`,
    version,
    extractChangelogNotes(join(dir, "CHANGELOG.md"), version),
  );
}

// The canonical framework release tag (ADR 0034 pt 4): release-scoped sync
// pulls the `v<frameworkVersion>` tarball and child workflow wrappers pin it
// in their `uses:` refs. The per-package changesets tag alone left upgrades
// hard-failing on `ref not found (v<version>)` until this tag was pushed by
// hand — the release train now owns it.
if (frameworkVersion) {
  ensureRelease(
    `v${frameworkVersion}`,
    frameworkVersion,
    `Framework release ${frameworkVersion} — the platform release tag release-scoped sync and child workflow refs pin (ADR 0034).`,
  );
}

console.log(`Published ${published} package(s) to npm.`);
