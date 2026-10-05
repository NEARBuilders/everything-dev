/**
 * Runtime-image node_modules prune (ticket 03, prod-builder stage).
 *
 * Derived, dev-only-deletion: the keep-set is the union of every workspace's
 * production dependency closure (dependencies + optionalDependencies,
 * transitively, walked through the installed tree). Peer dependencies are not
 * keep-edges — peers are optional by contract and every runtime-required peer
 * here is some workspace's direct production dependency. Platform-mismatched
 * optional binaries (os/cpu/libc, including the -musl/-gnu name convention)
 * are pruned even when declared. A package is deleted only when nothing
 * derives it as a runtime need — so new dev deps prune automatically.
 * Deliberately not a reachability prune (Bun has no native equivalent; a
 * synthesized production install cannot use --frozen-lockfile).
 *
 * Usage: bun scripts/prune-runtime-node-modules.ts [root]
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DEP_FIELDS = ["dependencies", "optionalDependencies"] as const;

type Platform = { platform: string; arch: string; musl: boolean };

function detectPlatform(): Platform {
  return {
    platform: process.platform,
    arch: process.arch,
    musl: existsSync("/etc/alpine-release"),
  };
}

function platformMatches(pkg: Record<string, any>, platform: Platform): boolean {
  const name: string = pkg.name ?? "";
  const os: string[] | undefined = pkg.os;
  const cpu: string[] | undefined = pkg.cpu;
  const libc: string[] | undefined = pkg.libc;
  if (os && !os.includes(platform.platform)) return false;
  if (cpu && !cpu.includes(platform.arch)) return false;
  if (libc) return libc.includes(platform.musl ? "musl" : "glibc");
  if (name.endsWith("-musl")) return platform.musl;
  if (name.endsWith("-gnu")) return !platform.musl;
  return true;
}

export function readPackageJson(path: string): Record<string, any> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function expandWorkspaceGlobs(root: string, patterns: string[]): string[] {
  const found: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = join(root, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        found.push(join(parent, entry.name));
      }
    } else {
      found.push(join(root, pattern));
    }
  }
  return found.filter((dir) => existsSync(join(dir, "package.json")));
}

export function computeKeepSet(nodeModulesDir: string, seedPackageJsons: string[]): Set<string> {
  const keep = new Set<string>();
  const queue: string[] = [];
  const enqueueDepsOf = (packageJsonPath: string): void => {
    const pkg = readPackageJson(packageJsonPath);
    if (!pkg) return;
    for (const field of DEP_FIELDS) {
      for (const name of Object.keys(pkg[field] ?? {})) queue.push(name);
    }
  };

  for (const seed of seedPackageJsons) {
    enqueueDepsOf(seed);
    const seedPkg = readPackageJson(seed);
    if (seedPkg?.name) queue.push(seedPkg.name);
  }

  while (queue.length > 0) {
    const name = queue.pop()!;
    if (keep.has(name)) continue;
    const packageJsonPath = join(nodeModulesDir, name, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    keep.add(name);
    enqueueDepsOf(packageJsonPath);
  }
  return keep;
}

export function pruneNodeModules(
  nodeModulesDir: string,
  keep: Set<string>,
  platform: Platform = detectPlatform(),
): { removed: string[] } {
  const removed: string[] = [];
  const drop = (dir: string, name: string): void => {
    rmSync(dir, { recursive: true, force: true });
    removed.push(name);
  };
  const pruneDir = (dir: string, name: string): void => {
    if (!keep.has(name)) {
      drop(dir, name);
      return;
    }
    const pkg = readPackageJson(join(dir, "package.json"));
    if (pkg && !platformMatches(pkg, platform)) drop(dir, name);
  };
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name);
      for (const child of readdirSync(scopeDir, { withFileTypes: true })) {
        const name = `${entry.name}/${child.name}`;
        pruneDir(join(scopeDir, child.name), name);
      }
      if (readdirSync(scopeDir).length === 0) rmSync(scopeDir, { recursive: true, force: true });
      continue;
    }
    pruneDir(join(nodeModulesDir, entry.name), entry.name);
  }
  return { removed };
}

function main(): void {
  const root = process.argv[2] ?? process.cwd();
  const rootPkg = readPackageJson(join(root, "package.json"));
  if (!rootPkg) throw new Error(`no package.json at ${root}`);

  const workspacePatterns: string[] = rootPkg.workspaces?.packages ?? rootPkg.workspaces ?? [];
  const workspaceDirs = expandWorkspaceGlobs(root, workspacePatterns);
  const seedPackageJsons = [
    join(root, "package.json"),
    ...workspaceDirs.map((d) => join(d, "package.json")),
  ];

  const nodeModulesDir = join(root, "node_modules");
  const before = existsSync(nodeModulesDir) ? readdirSync(nodeModulesDir).length : 0;
  const keep = computeKeepSet(nodeModulesDir, seedPackageJsons);
  const { removed } = pruneNodeModules(nodeModulesDir, keep);

  console.log(
    `[prune] node_modules: ${before} top-level entries → kept ${keep.size} packages (of ${before}), removed ${removed.length}`,
  );
  if (removed.length > 0) {
    console.log(
      `[prune] removed: ${removed.slice(0, 40).join(", ")}${removed.length > 40 ? `, +${removed.length - 40} more` : ""}`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) main();
