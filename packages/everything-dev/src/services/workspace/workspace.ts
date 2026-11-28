import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Data } from "effect";
import { parse } from "yaml";
import { BUILD_REPORT_FILENAME } from "../../infra/filenames";
import { run } from "../../utils/run";

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

export type StalenessOracleKind = "mtime" | "content-hash";

/**
 * Why a member was judged stale (#483). The mtime oracle reports input drift
 * as input-hash-mismatch — it has no hashes, only newer-than-dist.
 */
export type StalenessReason =
  | "no-cache-entry"
  | "missing-dist"
  | "input-hash-mismatch"
  | "dist-hash-mismatch"
  | `dependency-stale:${string}`;

export interface StalenessVerdict {
  readonly stale: boolean;
  readonly reason: StalenessReason | null;
  readonly oracle: StalenessOracleKind;
}

export interface StalenessOracle {
  isStale(member: WorkspaceMember): Promise<boolean>;
  /** Post-build hook (#430): hash oracles persist the member's input hash so
   * the next judgement can be fresh. Optional — the mtime oracle ignores it. */
  recordBuilt?(member: WorkspaceMember): Promise<void>;
  /** Non-destructive explain (#483): verdict, stale reason, and the oracle
   * kind in play. Optional — isStale stays the boolean contract. */
  judge?(member: WorkspaceMember): Promise<StalenessVerdict>;
}

export const mtimeStalenessOracle: StalenessOracle = {
  isStale: isStaleMember,
  judge: async (member) => {
    const distEntry = distOracle(member.dir);
    if (!distEntry) return { stale: false, reason: null, oracle: "mtime" };
    if (!existsSync(join(member.dir, distEntry))) {
      return { stale: true, reason: "missing-dist", oracle: "mtime" };
    }
    const stale = await isWorkspaceDistStale(member.dir, distEntry);
    return { stale, reason: stale ? "input-hash-mismatch" : null, oracle: "mtime" };
  },
};

/** Judge through the explain seam when the oracle has one (#483); an oracle
 * without a judge falls back to the boolean path with best-effort fields. */
export async function judgeStaleness(
  oracle: StalenessOracle,
  member: WorkspaceMember,
): Promise<StalenessVerdict> {
  if (oracle.judge) return oracle.judge(member);
  const stale = await oracle.isStale(member);
  return { stale, reason: stale ? "input-hash-mismatch" : null, oracle: "mtime" };
}

const HASH_SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".bos", ".turbo", ".next"]);

type FileStatsManifest = Record<string, [number, number]>;

async function walkFileStats(
  dir: string,
  prefix = "",
  files: FileStatsManifest = {},
): Promise<FileStatsManifest> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (HASH_SKIP_DIRS.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkFileStats(join(dir, entry.name), relative, files);
    } else {
      const stats = await stat(join(dir, entry.name));
      files[relative] = [stats.mtimeMs, stats.size];
    }
  }
  return files;
}

function statsManifestEquals(recorded: FileStatsManifest, current: FileStatsManifest): boolean {
  if (Object.keys(recorded).length !== Object.keys(current).length) return false;
  for (const [relative, [mtimeMs, size]] of Object.entries(current)) {
    const saved = recorded[relative];
    if (!saved || saved[0] !== mtimeMs || saved[1] !== size) return false;
  }
  return true;
}

async function hashWorkspaceTree(
  dir: string,
  hash: ReturnType<typeof createHash>,
  prefix = "",
  files?: FileStatsManifest,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (HASH_SKIP_DIRS.has(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await hashWorkspaceTree(join(dir, entry.name), hash, relative, files);
    } else {
      const path = join(dir, entry.name);
      hash.update(relative);
      hash.update(await readFile(path));
      if (files) {
        const stats = await stat(path);
        files[relative] = [stats.mtimeMs, stats.size];
      }
    }
  }
}

interface SelfHashResult {
  selfHash: string;
  files: FileStatsManifest;
}

async function computeSelfHash(member: WorkspaceMember, envKey: string): Promise<SelfHashResult> {
  const hash = createHash("sha256");
  const files: FileStatsManifest = {};
  await hashWorkspaceTree(member.dir, hash, "", files);
  hash.update(envKey);
  return { selfHash: hash.digest("hex"), files };
}

function composeInputHash(selfHash: string, depEntries: readonly [string, string][]): string {
  const hash = createHash("sha256");
  hash.update(selfHash);
  hash.update(
    depEntries
      .map(([dep, depHash]) => `${dep}:${depHash}`)
      .sort()
      .join("|"),
  );
  return hash.digest("hex");
}

interface DistOutputRecord {
  entry: string;
  hash: string;
  anchorHash: string;
  files: FileStatsManifest;
}

function distRootSegment(distEntry: string): string | null {
  const normalized = distEntry.replace(/^\.\//, "");
  const segments = normalized.split("/");
  return segments.length > 1 ? (segments[0] ?? null) : null;
}

async function hashDistOutput(memberDir: string, distEntry: string): Promise<DistOutputRecord> {
  const hash = createHash("sha256");
  const files: FileStatsManifest = {};
  const root = distRootSegment(distEntry);
  if (root) {
    await hashWorkspaceTree(join(memberDir, root), hash, root, files);
  }
  const normalized = distEntry.replace(/^\.\//, "");
  hash.update(normalized);
  const entryPath = join(memberDir, distEntry);
  const entryBytes = await readFile(entryPath);
  hash.update(entryBytes);
  const entryStats = await stat(entryPath);
  files[normalized] = [entryStats.mtimeMs, entryStats.size];
  const anchorHash = createHash("sha256").update(entryBytes).digest("hex");
  return { entry: distEntry, hash: hash.digest("hex"), anchorHash, files };
}

/**
 * Dist integrity (#482): the entry file is the distOracle existence probe, so
 * its bytes are re-verified on every judgement; siblings ride the stats fast
 * path — identical stats trust the recorded hash (the same residual risk #481
 * accepts for inputs).
 */
async function distIntegrityReason(
  memberDir: string,
  distEntry: string,
  record: DistOutputRecord | undefined,
): Promise<StalenessReason | null> {
  if (!record) return "dist-hash-mismatch";
  const anchor = createHash("sha256");
  anchor.update(await readFile(join(memberDir, distEntry)));
  if (anchor.digest("hex") !== record.anchorHash) return "dist-hash-mismatch";
  const root = distRootSegment(distEntry);
  if (!root) return null;
  if (statsManifestEquals(record.files, await walkFileStats(join(memberDir, root), root))) {
    return null;
  }
  const current = await hashDistOutput(memberDir, distEntry);
  return current.hash === record.hash ? null : "dist-hash-mismatch";
}

interface BuildCacheEntry {
  hash?: string;
  selfHash?: string;
  envKey?: string;
  files?: FileStatsManifest;
  deps?: Record<string, string>;
  dist?: DistOutputRecord;
}

/**
 * v2 cache shape (#481/#482): each member carries a per-file [mtimeMs, size]
 * manifest so the next judgement can skip content reads, plus the dist output
 * record. Pre-v2 flat caches fail the version gate wholesale instead of
 * half-matching; bump only when the entry semantics change again.
 */
const BUILD_CACHE_VERSION = 2;

interface BuildCacheFile {
  version: number;
  members: Record<string, BuildCacheEntry>;
}

/**
 * Content-hash staleness oracle (#430) — a Turborepo-style judgement: a
 * member is fresh when its recorded input hash (workspace tree + transitive
 * local-dependency hashes + build-mode env) matches, its dist entry still
 * exists, and the dist bytes still match the recorded output hash (#482).
 * Anything unknown (no cache entry, unreadable tree, hash mismatch) errs
 * toward building. `recordBuilt` persists post-build so the next run starts
 * from truth; the cache lives at <workspaceRoot>/.bos/build-cache.json.
 *
 * #481 fast path: when the tree's [mtimeMs, size] stats match the entry's
 * manifest, the recorded self hash is reused without reading file contents;
 * any drift (changed/new/removed file) falls back to a full rehash. Dep
 * hashes still compose transitively in the fast path — a dep's verdict feeds
 * its dependents through the same memo.
 */
export function contentHashStalenessOracle(
  rootDir: string,
  members: readonly WorkspaceMember[],
): StalenessOracle {
  const cachePath = join(rootDir, ".bos", "build-cache.json");
  const envKey = `${process.env.NODE_ENV ?? ""}|${process.env.DEPLOY ?? ""}`;
  const byName = new Map(members.map((member) => [member.name, member]));

  const readCache = (): BuildCacheFile => {
    try {
      const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<BuildCacheFile> | null;
      if (
        parsed?.version !== BUILD_CACHE_VERSION ||
        typeof parsed.members !== "object" ||
        parsed.members === null
      ) {
        return { version: BUILD_CACHE_VERSION, members: {} };
      }
      return { version: BUILD_CACHE_VERSION, members: parsed.members };
    } catch {
      return { version: BUILD_CACHE_VERSION, members: {} };
    }
  };

  const writeCache = (cache: BuildCacheFile) => {
    try {
      mkdirSync(join(rootDir, ".bos"), { recursive: true });
      writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    } catch {
      // An unwritable cache only costs rebuilds — never fail the train.
    }
  };

  interface MemberJudgement {
    verdict: StalenessVerdict;
    inputHash: string;
  }

  const createJudgementPass = (cache: Record<string, BuildCacheEntry>) => {
    // Fresh memo per pass: a previous pass's hashes must not leak — the tree
    // may have changed since.
    const memo = new Map<string, Promise<MemberJudgement>>();

    const resolveSelfHash = async (
      member: WorkspaceMember,
      entry: BuildCacheEntry | undefined,
    ): Promise<string> => {
      if (entry?.selfHash && entry.envKey === envKey && entry.files) {
        if (statsManifestEquals(entry.files, await walkFileStats(member.dir))) {
          return entry.selfHash;
        }
      }
      return (await computeSelfHash(member, envKey)).selfHash;
    };

    const judgeVerdict = async (
      member: WorkspaceMember,
      entry: BuildCacheEntry | undefined,
      depEntries: readonly [string, string][],
      inputHash: string,
    ): Promise<StalenessVerdict> => {
      const distEntry = distOracle(member.dir);
      if (!distEntry || !existsSync(join(member.dir, distEntry))) {
        return { stale: true, reason: "missing-dist", oracle: "content-hash" };
      }
      if (!entry?.hash) {
        return { stale: true, reason: "no-cache-entry", oracle: "content-hash" };
      }
      for (const [dep, depHash] of depEntries) {
        if (entry.deps?.[dep] !== depHash) {
          return { stale: true, reason: `dependency-stale:${dep}`, oracle: "content-hash" };
        }
      }
      if (entry.hash !== inputHash) {
        return { stale: true, reason: "input-hash-mismatch", oracle: "content-hash" };
      }
      const distReason = await distIntegrityReason(member.dir, distEntry, entry.dist);
      if (distReason) return { stale: true, reason: distReason, oracle: "content-hash" };
      return { stale: false, reason: null, oracle: "content-hash" };
    };

    const judgeMember = (member: WorkspaceMember): Promise<MemberJudgement> => {
      const cached = memo.get(member.name);
      if (cached) return cached;
      const computed = (async (): Promise<MemberJudgement> => {
        const entry = cache[member.name];
        const depEntries: [string, string][] = [];
        for (const dep of member.localDeps) {
          const depMember = byName.get(dep);
          if (!depMember) continue;
          depEntries.push([dep, (await judgeMember(depMember)).inputHash]);
        }
        const selfHash = await resolveSelfHash(member, entry);
        const inputHash = composeInputHash(selfHash, depEntries);
        return { verdict: await judgeVerdict(member, entry, depEntries, inputHash), inputHash };
      })();
      memo.set(member.name, computed);
      return computed;
    };

    return judgeMember;
  };

  const judge = async (member: WorkspaceMember): Promise<StalenessVerdict> => {
    try {
      const judgeMember = createJudgementPass(readCache().members);
      return (await judgeMember(member)).verdict;
    } catch {
      // Unreadable state (missing tree, unparsable cache) judges stale; the
      // reason is best-effort — explain must never crash the caller.
      return { stale: true, reason: "input-hash-mismatch", oracle: "content-hash" };
    }
  };

  return {
    judge,
    isStale: async (member) => {
      try {
        return (await judge(member)).stale;
      } catch {
        return true;
      }
    },
    recordBuilt: async (member) => {
      try {
        const cache = readCache();
        const judgeMember = createJudgementPass(cache.members);
        const depEntries: [string, string][] = [];
        for (const dep of member.localDeps) {
          const depMember = byName.get(dep);
          if (!depMember) continue;
          depEntries.push([dep, (await judgeMember(depMember)).inputHash]);
        }
        const { selfHash, files } = await computeSelfHash(member, envKey);
        const distEntry = distOracle(member.dir);
        const dist =
          distEntry && existsSync(join(member.dir, distEntry))
            ? await hashDistOutput(member.dir, distEntry)
            : undefined;
        cache.members[member.name] = {
          hash: composeInputHash(selfHash, depEntries),
          selfHash,
          envKey,
          files,
          deps: Object.fromEntries(depEntries),
          ...(dist ? { dist } : {}),
        };
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

  const exportsMap =
    manifest.exports && typeof manifest.exports === "object"
      ? (manifest.exports as Record<string, unknown>)
      : undefined;
  const entry = exportsMap?.["."];
  if (entry && typeof entry === "object") {
    for (const key of ["import", "default", "require", "types"] as const) {
      const value = (entry as Record<string, unknown>)[key];
      if (typeof value === "string" && !value.startsWith("./src")) return value;
    }
  }
  // Subpath-only packages (no root export): the first subpath advertising a
  // dist import marks the build — tsdown emits every entry, so any one of
  // them existing proves the dist is present.
  if (exportsMap) {
    for (const value of Object.values(exportsMap)) {
      if (typeof value !== "object" || value === null) continue;
      for (const key of ["import", "default", "require"] as const) {
        const candidate = (value as Record<string, unknown>)[key];
        if (typeof candidate === "string" && !candidate.startsWith("./src")) return candidate;
      }
    }
  }
  if (typeof manifest.module === "string" && !manifest.module.startsWith("./src")) {
    return manifest.module;
  }
  if (typeof manifest.main === "string" && !manifest.main.startsWith("./src")) {
    return manifest.main;
  }

  const reportPath = join(memberDir, "dist", BUILD_REPORT_FILENAME);
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
