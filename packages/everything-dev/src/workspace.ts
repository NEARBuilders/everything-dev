import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { run } from "./utils/run";

export interface WorkspaceMember {
  readonly name: string;
  readonly dir: string;
  readonly localDeps: readonly string[];
}

export interface WorkspaceRoot {
  readonly dir: string;
  readonly members: readonly WorkspaceMember[];
}

export interface DepsReport {
  readonly rebuilt: readonly WorkspaceMember[];
  readonly fresh: readonly WorkspaceMember[];
}

export interface DepsBuildFailureEntry {
  readonly member: WorkspaceMember;
  readonly exitCode: number;
  readonly output: string;
}

export class DepsBuildFailure extends Error {
  readonly failures: readonly DepsBuildFailureEntry[];

  constructor(failures: readonly DepsBuildFailureEntry[]) {
    const detail = failures
      .map(
        (failure) =>
          `${failure.member.name} (exit ${failure.exitCode})\n${outputTail(failure.output)}`,
      )
      .join("\n\n");
    super(`workspace dependency builds failed:\n${detail}`);
    this.name = "DepsBuildFailure";
    this.failures = [...failures];
  }
}

const workspaceRootCache = new Map<string, WorkspaceRoot | null>();

export function clearWorkspaceRootCache(): void {
  workspaceRootCache.clear();
}

export function findWorkspaceRoot(startDir: string): WorkspaceRoot | null {
  const key = resolve(startDir);
  const cached = workspaceRootCache.get(key);
  if (cached !== undefined) return cached;
  const found = discoverWorkspaceRoot(key);
  workspaceRootCache.set(key, found);
  return found;
}

function discoverWorkspaceRoot(dir: string): WorkspaceRoot | null {
  let current = dir;
  while (true) {
    const root = readWorkspaceRootAt(current);
    if (root) return root;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readWorkspaceRootAt(dir: string): WorkspaceRoot | null {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = readManifest(manifestPath);
  if (!manifest) return null;
  const globs = workspaceGlobs(manifest.workspaces);
  if (!globs) return null;

  const memberDirs = matchMemberDirs(dir, globs);
  const drafts: { name: string; dir: string; manifest: Record<string, unknown> }[] = [];
  for (const memberDir of memberDirs) {
    const memberManifest = readManifest(join(memberDir, "package.json"));
    if (!memberManifest || typeof memberManifest.name !== "string") continue;
    drafts.push({ name: memberManifest.name, dir: memberDir, manifest: memberManifest });
  }

  const names = new Set(drafts.map((draft) => draft.name));
  const members = drafts
    .map((draft) => ({
      name: draft.name,
      dir: draft.dir,
      localDeps: declaredDepNames(draft.manifest).filter((dep) => names.has(dep)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { dir, members };
}

function workspaceGlobs(workspaces: unknown): string[] | null {
  if (Array.isArray(workspaces)) {
    return workspaces.filter((glob): glob is string => typeof glob === "string");
  }
  if (workspaces && typeof workspaces === "object") {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((glob): glob is string => typeof glob === "string");
    }
  }
  return null;
}

function matchMemberDirs(rootDir: string, globs: readonly string[]): string[] {
  const found = new Set<string>();
  for (const glob of globs) {
    collectMemberDirs(rootDir, glob.split("/"), found);
  }
  return [...found].sort();
}

function collectMemberDirs(dir: string, segments: readonly string[], out: Set<string>): void {
  const [head, ...rest] = segments;
  if (!head) return;
  let entries: readonly { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (head !== "*" && head !== entry.name) continue;
    const child = join(dir, entry.name);
    if (rest.length === 0) out.add(child);
    else collectMemberDirs(child, rest, out);
  }
}

function readManifest(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function declaredDepNames(manifest: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = manifest[field];
    if (deps && typeof deps === "object") {
      names.push(...Object.keys(deps as Record<string, unknown>));
    }
  }
  return names;
}

export function localDepsOf(
  root: WorkspaceRoot,
  targetDirs: readonly string[],
): readonly WorkspaceMember[] {
  const byName = new Map(root.members.map((member) => [member.name, member]));
  const byDir = new Map(root.members.map((member) => [member.dir, member]));
  const ordered: WorkspaceMember[] = [];
  const seen = new Set<string>();

  const visit = (member: WorkspaceMember): void => {
    if (seen.has(member.name)) return;
    seen.add(member.name);
    for (const dep of member.localDeps) {
      const depMember = byName.get(dep);
      if (depMember) visit(depMember);
    }
    ordered.push(member);
  };

  for (const targetDir of targetDirs) {
    const target = byDir.get(resolve(targetDir));
    if (!target) continue;
    for (const dep of target.localDeps) {
      const depMember = byName.get(dep);
      if (depMember) visit(depMember);
    }
  }

  return ordered;
}

export async function ensureFreshDeps(
  startDir: string,
  targetDirs: readonly string[],
  opts?: { readonly force?: boolean },
): Promise<DepsReport> {
  const root = findWorkspaceRoot(startDir);
  if (!root) return { rebuilt: [], fresh: [] };

  const closure = localDepsOf(root, targetDirs);
  const force = opts?.force ?? false;
  const judgements = await Promise.all(
    closure.map(async (member) => force || (await isStaleMember(member))),
  );
  const rebuilt = closure.filter((_, index) => judgements[index]);
  const fresh = closure.filter((_, index) => !judgements[index]);

  if (rebuilt.length > 0) {
    const results = await Promise.allSettled(
      rebuilt.map((member) => run("bun", ["run", "build"], { cwd: member.dir, capture: true })),
    );
    const failures = results.flatMap((result, index) => {
      const value = result.status === "fulfilled" ? result.value : undefined;
      if (value && value.exitCode === 0) return [];
      const output = value
        ? `${value.stdout}\n${value.stderr}`
        : result.status === "rejected"
          ? String(result.reason)
          : "";
      return [
        {
          member: rebuilt[index],
          exitCode: value ? (value.exitCode ?? 1) : 1,
          output,
        },
      ];
    });
    if (failures.length > 0) throw new DepsBuildFailure(failures);
  }

  return { rebuilt, fresh };
}

async function isStaleMember(member: WorkspaceMember): Promise<boolean> {
  const oracle = distOracle(member.dir);
  if (!oracle) return false;
  return isWorkspaceDistStale(member.dir, oracle);
}

function distOracle(memberDir: string): string | null {
  const manifest = readManifest(join(memberDir, "package.json"));
  if (!manifest) return null;

  const entry =
    manifest.exports && typeof manifest.exports === "object"
      ? (manifest.exports as Record<string, unknown>)["."]
      : undefined;
  if (entry && typeof entry === "object") {
    for (const key of ["import", "default", "require", "types"] as const) {
      const value = (entry as Record<string, unknown>)[key];
      if (typeof value === "string" && !value.startsWith("./src")) return value;
    }
  }
  if (typeof manifest.module === "string" && !manifest.module.startsWith("./src")) {
    return manifest.module;
  }
  if (typeof manifest.main === "string" && !manifest.main.startsWith("./src")) {
    return manifest.main;
  }

  const reportPath = join(memberDir, "dist", "build-report.json");
  if (existsSync(reportPath)) {
    const report = readManifest(reportPath);
    if (report && typeof report.entry === "string" && report.entry) {
      return join("dist", report.entry);
    }
  }
  return null;
}

async function newestSourceMtimeMs(dir: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestSourceMtimeMs(fullPath));
    } else {
      newest = Math.max(newest, (await stat(fullPath)).mtimeMs);
    }
  }
  return newest;
}

export async function isWorkspaceDistStale(
  packageDir: string,
  distEntry: string,
): Promise<boolean> {
  const distPath = join(packageDir, distEntry);
  if (!existsSync(distPath)) return true;
  const [distMtime, srcMtime, pkgMtime] = await Promise.all([
    stat(distPath).then((s) => s.mtimeMs),
    newestSourceMtimeMs(join(packageDir, "src")),
    stat(join(packageDir, "package.json")).then((s) => s.mtimeMs),
  ]);
  return Math.max(srcMtime, pkgMtime) > distMtime;
}

function outputTail(output: string): string {
  const lines = output.trim().split("\n");
  return lines.slice(-10).join("\n");
}
