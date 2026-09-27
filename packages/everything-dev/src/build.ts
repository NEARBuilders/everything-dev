import { existsSync } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { formatDuration } from "./cli/timing";
import { resolveLocalDevelopmentPath } from "./config";
import type { WorkspaceDeployResult } from "./contract";
import { syncResolvedSharedDeps } from "./shared-deps";
import type { BosConfig, BosPluginRef, RuntimeConfig } from "./types";
import { run } from "./utils/run";
import { padRight } from "./utils/string";
import { colors, icons } from "./utils/theme";

const buildCommands: Record<string, { cmd: string; args: string[] }> = {
  host: { cmd: "bun", args: ["run", "build"] },
  ui: { cmd: "bun", args: ["run", "build"] },
  api: { cmd: "bun", args: ["run", "build"] },
};

export type WorkspaceTarget = {
  key: string;
  kind: "app" | "plugin";
  path: string;
};

export function getPluginRef(entry: string | BosPluginRef | undefined | null): BosPluginRef | null {
  if (!entry || typeof entry === "string") return null;
  return entry;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export function resolveWorkspaceTarget(
  key: string,
  bosConfig: BosConfig | null,
  runtimeConfig: RuntimeConfig | null,
  configDir: string,
): WorkspaceTarget | null {
  if (bosConfig?.app && key in bosConfig.app) {
    const appEntry = (bosConfig.app as Record<string, { development?: string }>)[key];
    const devPath = resolveLocalDevelopmentPath(appEntry?.development, configDir);
    if (devPath) {
      return {
        key,
        kind: "app",
        path: devPath,
      };
    }
    return {
      key,
      kind: "app",
      path: `${configDir}/${key}`,
    };
  }

  const runtimePlugin = runtimeConfig?.plugins?.[key];
  const pluginPath =
    runtimePlugin?.localPath ??
    resolveLocalDevelopmentPath(getPluginRef(bosConfig?.plugins?.[key])?.development, configDir);
  if (pluginPath) {
    return {
      key,
      kind: "plugin",
      path: pluginPath,
    };
  }

  return null;
}

export function selectWorkspaceTargets(packages: string, bosConfig: BosConfig | null): string[] {
  const allPackages = [
    ...Object.keys(bosConfig?.app ?? {}),
    ...Object.keys(bosConfig?.plugins ?? {}),
  ];
  if (packages === "all") {
    return allPackages;
  }
  if (packages === "local") {
    return allPackages.filter((k) => isLocalTarget(k, bosConfig));
  }

  return packages
    .split(",")
    .map((pkg) => pkg.trim())
    .filter((pkg) => allPackages.includes(pkg));
}

function isLocalTarget(key: string, bosConfig: BosConfig | null): boolean {
  const slot =
    (bosConfig?.app as Record<string, { development?: string }> | undefined)?.[key] ??
    bosConfig?.plugins?.[key];
  const dev = (slot as { development?: unknown } | undefined)?.development;
  return typeof dev === "string" && dev.startsWith("local:");
}

interface WorkspaceBuildOutcome {
  key: string;
  kind: "app" | "plugin";
  success: boolean;
  error?: string;
  durationMs: number;
}

async function buildOneWorkspace(
  ws: WorkspaceTarget,
  env: Record<string, string>,
  opts: { verbose?: boolean },
): Promise<WorkspaceBuildOutcome> {
  const buildConfig = buildCommands[ws.key] ?? { cmd: "bun", args: ["run", "build"] };
  const verbose = opts.verbose ?? false;
  const startTime = Date.now();

  const proc = await run(buildConfig.cmd, buildConfig.args, {
    cwd: ws.path,
    env,
    capture: true,
    onChunk: (stream, chunk) => {
      if (stream === "stderr") {
        process.stderr.write(chunk);
      } else if (verbose) {
        process.stdout.write(chunk);
      }
    },
  });

  const exitCode = proc?.exitCode ?? 0;
  const durationMs = Date.now() - startTime;
  const output = `${proc?.stdout ?? ""}\n${proc?.stderr ?? ""}`;
  const result: WorkspaceBuildOutcome = {
    key: ws.key,
    kind: ws.kind,
    success: exitCode === 0,
    ...(exitCode !== 0 && {
      error: `Build failed (exit code ${exitCode})\n${output.trim().split("\n").slice(-5).join("\n")}`,
    }),
    durationMs,
  };

  if (!verbose) {
    const name = padRight(ws.key, 28);
    if (result.success) {
      console.log(`  ${colors.green(icons.ok)} ${name} ${colors.dim(formatDuration(durationMs))}`);
    } else {
      const errorLine = (result.error ?? "Failed").split("\n")[0];
      console.log(`  ${colors.error(icons.err)} ${name} ${errorLine}`);
    }
  }

  return result;
}

export async function buildWorkspaceTargets(opts: {
  configDir: string;
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  targets: string[];
  deploy: boolean;
  verbose?: boolean;
}): Promise<{
  built: string[];
  skipped: string[];
  deployResults?: WorkspaceDeployResult[];
}> {
  const existing: WorkspaceTarget[] = [];
  const skipped: string[] = [];

  for (const target of opts.targets) {
    const resolved = resolveWorkspaceTarget(
      target,
      opts.bosConfig,
      opts.runtimeConfig,
      opts.configDir,
    );
    if (!resolved) {
      skipped.push(target);
      continue;
    }

    const exists = await fileExists(`${resolved.path}/package.json`);
    if (exists) existing.push(resolved);
    else skipped.push(target);
  }

  if (existing.length === 0) {
    return { built: [], skipped };
  }

  const sharedSync = await syncResolvedSharedDeps({
    configDir: opts.configDir,
    hostMode: "local",
    bosConfig: opts.bosConfig ?? undefined,
    extendsChain: [],
  });
  if (sharedSync.catalogChanged) {
    await run("bun", ["install"], { cwd: opts.configDir });
  }

  const forceRebuild = opts.deploy;
  // Unconditional prerequisite train: every-plugin's dist is a runtime shared
  // dep of server plugin builds, everything-dev's dist is bundled into ui/api
  // code (ui/auth, db) — both must be fresh before any target builds.
  // Bundler-config factories resolve from src (not dist), so the config chain
  // itself cannot go stale. No-ops when fresh (isWorkspaceDistStale).
  const buildTasks: Promise<unknown>[] = [
    buildEverythingDevQuietly(opts.configDir, forceRebuild),
    buildBetterNearAuthQuietly(opts.configDir, forceRebuild),
    buildEveryPluginQuietly(opts.configDir, forceRebuild),
  ];
  await Promise.all(buildTasks);

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: opts.deploy ? "production" : "development",
  };

  const orderedExisting = opts.deploy
    ? [
        ...existing.filter((entry) => entry.kind === "app" && entry.key !== "host"),
        ...existing.filter((entry) => entry.kind === "plugin"),
        ...existing.filter((entry) => entry.kind === "app" && entry.key === "host"),
      ]
    : existing;

  const parallelGroup = opts.deploy
    ? orderedExisting.filter((e) => e.key !== "host")
    : orderedExisting;
  const sequentialGroup = opts.deploy ? orderedExisting.filter((e) => e.key === "host") : [];

  const built: string[] = [];
  const deployResults: WorkspaceDeployResult[] = [];

  if (opts.deploy && parallelGroup.length > 0) {
    const total = parallelGroup.length + sequentialGroup.length;
    console.log();
    console.log(`  Building ${total} workspace${total > 1 ? "s" : ""}...`);
    console.log();

    const results = await Promise.allSettled(
      parallelGroup.map((ws) => buildOneWorkspace(ws, env, opts)),
    );

    for (let i = 0; i < parallelGroup.length; i++) {
      const ws = parallelGroup[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        if (result.value.success) {
          built.push(ws.key);
        }
        deployResults.push(result.value);
      } else {
        deployResults.push({
          key: ws.key,
          kind: ws.kind,
          success: false,
          error: result.reason?.message ?? "Unknown error",
        });
      }
    }

    for (const ws of sequentialGroup) {
      const result = await buildOneWorkspace(ws, env, opts);
      if (result.success) {
        built.push(ws.key);
      }
      deployResults.push(result);
    }

    console.log();
  } else {
    for (const resolved of orderedExisting) {
      const buildConfig = buildCommands[resolved.key] ?? {
        cmd: "bun",
        args: ["run", "build"],
      };

      await run(buildConfig.cmd, buildConfig.args, {
        cwd: resolved.path,
        env,
      });
      built.push(resolved.key);
    }
  }

  return { built, skipped, deployResults: opts.deploy ? deployResults : undefined };
}

export async function buildEveryPluginQuietly(cwd: string, force = false) {
  const packageDir = `${cwd}/packages/every-plugin`;
  const packageExists = await fileExists(`${packageDir}/package.json`);
  if (!packageExists) {
    return;
  }

  if (!force && !(await isWorkspaceDistStale(packageDir, "dist/build/rspack/plugin.mjs"))) {
    return;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/every-plugin", "build"], {
    cwd,
    capture: true,
  })) as { stdout: string; stderr: string; exitCode: number };

  if (result.exitCode === 0) {
    return;
  }

  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  throw new Error(
    `bun run --cwd packages/every-plugin build failed with exit code ${result.exitCode}`,
  );
}

export async function buildBetterNearAuthQuietly(cwd: string, force = false) {
  const packageDir = `${cwd}/packages/better-near-auth`;
  const packageExists = await fileExists(`${packageDir}/package.json`);
  if (!packageExists) {
    return;
  }

  if (!force && !(await isWorkspaceDistStale(packageDir, "dist/index.js"))) {
    return;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/better-near-auth", "build"], {
    cwd,
    capture: true,
  })) as { stdout: string; stderr: string; exitCode: number };

  if (result.exitCode === 0) {
    return;
  }

  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  throw new Error(
    `bun run --cwd packages/better-near-auth build failed with exit code ${result.exitCode}`,
  );
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

/**
 * Decide whether a workspace's dist bundle predates its sources.
 *
 * rspack-built services resolve workspace packages (e.g. `everything-dev/db`)
 * via their `dist` exports, so a stale dist silently ships old code to dev
 * servers. Compares the dist entry's mtime against the newest source file
 * and package.json mtime.
 */
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

export async function buildEverythingDevQuietly(cwd: string, force = false): Promise<boolean> {
  const packageDir = `${cwd}/packages/everything-dev`;
  const packageExists = await fileExists(`${packageDir}/package.json`);
  if (!packageExists) {
    return false;
  }

  if (!force && !(await isWorkspaceDistStale(packageDir, "dist/index.mjs"))) {
    return false;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/everything-dev", "build"], {
    cwd,
    capture: true,
  })) as { stdout: string; stderr: string; exitCode: number };

  if (result.exitCode === 0) {
    return true;
  }

  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  throw new Error(
    `bun run --cwd packages/everything-dev build failed with exit code ${result.exitCode}`,
  );
}
