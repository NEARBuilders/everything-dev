import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Data } from "effect";
import { parse } from "yaml";
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

export class DepsBuildFailure extends Data.TaggedError("DepsBuildFailure")<{
  readonly failures: readonly DepsBuildFailureEntry[];
}> {
  override get message() {
    const detail = this.failures
      .map(
        (failure) =>
          `${failure.member.name} (exit ${failure.exitCode})\n${outputTail(failure.output)}`,
      )
      .join("\n\n");
    return `workspace dependency builds failed:\n${detail}`;
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
  // v2 (ADR 0026): workspace globs live in pnpm-workspace.yaml. Pre-v2
  // runtimes keep the package.json workspaces fallback.
  const yamlPath = join(dir, "pnpm-workspace.yaml");
  if (existsSync(yamlPath)) {
    const doc = parse(readFileSync(yamlPath, "utf8")) as { packages?: unknown } | null;
    const globs = workspaceGlobsFromYaml(doc?.packages);
    if (globs) return readWorkspaceMembers(dir, globs);
  }

  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = readManifest(manifestPath);
  if (!manifest) return null;
  const globs = workspaceGlobs(manifest.workspaces);
  if (!globs) return null;

  return readWorkspaceMembers(dir, globs);
}

function workspaceGlobsFromYaml(packages: unknown): string[] | null {
  if (!Array.isArray(packages)) return null;
  const globs = packages.filter((glob): glob is string => typeof glob === "string");
  return globs.length > 0 ? globs : null;
}

function readWorkspaceMembers(dir: string, globs: readonly string[]): WorkspaceRoot {
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
  opts?: {
    readonly force?: boolean;
    /** Build-mode contract for prerequisite children (ADR 0018): deploy
     * builds run dist-first, so every build child — prerequisite or target —
     * must receive the same env; a bundler-config workspace in the closure
     * resolves differently without it. Callers that pass nothing keep the
     * ambient env (dev-time staleness rebuilds). */
    readonly env?: Record<string, string>;
    /** Staleness oracle seam (#424): defaults to the mtime oracle. Force
     * skips the oracle entirely — a forced build never judges. */
    readonly oracle?: StalenessOracle;
  },
): Promise<DepsReport> {
  const root = findWorkspaceRoot(startDir);
  if (!root) return { rebuilt: [], fresh: [] };

  const closure = localDepsOf(root, targetDirs);
  const force = opts?.force ?? false;
  const oracle = opts?.oracle ?? mtimeStalenessOracle;
  const judgements = await Promise.all(
    closure.map(async (member) => force || (await oracle.isStale(member))),
  );
  const rebuilt = closure.filter((_, index) => judgements[index]);
  const fresh = closure.filter((_, index) => !judgements[index]);

  const failures: DepsBuildFailureEntry[] = [];
  const builtOk: WorkspaceMember[] = [];
  // Layered order: a member's dist must exist before its dependents build —
  // dts emit resolves types through dependency dists, so building the whole
  // stale closure in parallel races (everything-dev dts collapsing to `any`
  // when its deps were still writing dists was shipped this way in rc.1).
  for (const layer of buildLayers(rebuilt)) {
    const results = await Promise.allSettled(
      layer.map((member) =>
        run("pnpm", ["run", "build"], {
          cwd: member.dir,
          capture: true,
          env: opts?.env,
        }),
      ),
    );
    const layerFailures = results.flatMap((result, index) => {
      const value = result.status === "fulfilled" ? result.value : undefined;
      if (value && value.exitCode === 0) {
        builtOk.push(layer[index]);
        return [];
      }
      const output = value
        ? `${value.stdout}\n${value.stderr}`
        : result.status === "rejected"
          ? String(result.reason)
          : "";
      return [
        {
          member: layer[index],
          exitCode: value ? (value.exitCode ?? 1) : 1,
          output,
        },
      ];
    });
    failures.push(...layerFailures);
    if (failures.length > 0) break;
  }
  if (failures.length > 0) throw new DepsBuildFailure({ failures });

  for (const member of builtOk) {
    await oracle.recordBuilt?.(member);
  }

  return { rebuilt, fresh };
}

export function buildLayers(members: readonly WorkspaceMember[]): readonly WorkspaceMember[][] {
  const byName = new Map(members.map((member) => [member.name, member]));
  const remaining = new Set(members.map((member) => member.name));
  const layers: WorkspaceMember[][] = [];
  while (remaining.size > 0) {
    const layer = members.filter(
      (member) =>
        remaining.has(member.name) &&
        member.localDeps.every((dep) => !byName.has(dep) || !remaining.has(dep)),
    );
    if (layer.length === 0) {
      throw new Error(`dependency cycle in workspace closure: ${[...remaining].join(", ")}`);
    }
    for (const member of layer) remaining.delete(member.name);
    layers.push(layer);
  }
  return layers;
}

async function isStaleMember(member: WorkspaceMember): Promise<boolean> {
  const oracle = distOracle(member.dir);
  if (!oracle) return false;
  return isWorkspaceDistStale(member.dir, oracle);
}

export interface StalenessOracle {
  isStale(member: WorkspaceMember): Promise<boolean>;
  /** Post-build hook (#430): hash oracles persist the member's input hash so
   * the next judgement can be fresh. Optional — the mtime oracle ignores it. */
  recordBuilt?(member: WorkspaceMember): Promise<void>;
}

export const mtimeStalenessOracle: StalenessOracle = {
  isStale: isStaleMember,
};

const HASH_SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".bos", ".turbo", ".next"]);

async function hashWorkspaceTree(dir: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (HASH_SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory()) {
      await hashWorkspaceTree(join(dir, entry.name), hash);
    } else {
      const content = await readFile(join(dir, entry.name));
      hash.update(entry.name);
      hash.update(content);
    }
  }
}

async function memberInputHash(
  member: WorkspaceMember,
  byName: Map<string, WorkspaceMember>,
  memo: Map<string, Promise<string>>,
  envKey: string,
): Promise<string> {
  const cached = memo.get(member.name);
  if (cached) return cached;
  const computed = (async () => {
    const own = createHash("sha256");
    await hashWorkspaceTree(member.dir, own);
    const depHashes: string[] = [];
    for (const dep of member.localDeps) {
      const depMember = byName.get(dep);
      if (depMember) {
        depHashes.push(`${dep}:${await memberInputHash(depMember, byName, memo, envKey)}`);
      }
    }
    own.update(envKey);
    own.update(depHashes.sort().join("|"));
    return own.digest("hex");
  })();
  memo.set(member.name, computed);
  return computed;
}

/**
 * Content-hash staleness oracle (#430) — a Turborepo-style judgement: a
 * member is fresh when its recorded input hash (workspace tree + transitive
 * local-dependency hashes + build-mode env) matches and its dist entry still
 * exists. Anything unknown (no cache entry, unreadable tree, hash mismatch)
 * errs toward building. `recordBuilt` persists post-build so the next run
 * starts from truth; the cache lives at <workspaceRoot>/.bos/build-cache.json.
 */
export function contentHashStalenessOracle(
  rootDir: string,
  members: readonly WorkspaceMember[],
): StalenessOracle {
  const cachePath = join(rootDir, ".bos", "build-cache.json");
  const envKey = `${process.env.NODE_ENV ?? ""}|${process.env.DEPLOY ?? ""}`;
  const byName = new Map(members.map((member) => [member.name, member]));

  const readCache = (): Record<string, { hash?: string }> => {
    try {
      return JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, { hash?: string }>;
    } catch {
      return {};
    }
  };

  const writeCache = (cache: Record<string, { hash?: string }>) => {
    try {
      mkdirSync(join(rootDir, ".bos"), { recursive: true });
      writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    } catch {
      // An unwritable cache only costs rebuilds — never fail the train.
    }
  };

  return {
    isStale: async (member) => {
      try {
        const distEntry = distOracle(member.dir);
        if (!distEntry) return true;
        if (!existsSync(join(member.dir, distEntry))) return true;
        // Fresh memo per judgement: a previous call's hashes must not leak —
        // the tree may have changed since.
        const memo = new Map<string, Promise<string>>();
        const current = await memberInputHash(member, byName, memo, envKey);
        return readCache()[member.name]?.hash !== current;
      } catch {
        return true;
      }
    },
    recordBuilt: async (member) => {
      try {
        const memo = new Map<string, Promise<string>>();
        const current = await memberInputHash(member, byName, memo, envKey);
        const cache = readCache();
        cache[member.name] = { hash: current };
        writeCache(cache);
      } catch {
        // A failed recording costs a rebuild next run — never fail the build.
      }
    },
  };
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
