import { access, readFile } from "node:fs/promises";
import process from "node:process";
import { formatDuration } from "./cli/timing";
import { resolveLocalDevelopmentPath } from "./config";
import type { WorkspaceDeployResult } from "./contract";
import { syncResolvedSharedDeps } from "./shared-deps";
import type { BosConfig, BosPluginRef, RuntimeConfig } from "./types";
import { describeError } from "./utils/error";
import { run } from "./utils/run";
import { padRight } from "./utils/string";
import { colors, icons } from "./utils/theme";
import { ensureFreshDeps, findWorkspaceRoot } from "./workspace";

const buildCommands: Record<string, { cmd: string; args: string[] }> = {
  host: { cmd: "pnpm", args: ["run", "build"] },
  ui: { cmd: "pnpm", args: ["run", "build"] },
  api: { cmd: "pnpm", args: ["run", "build"] },
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
  const buildConfig = buildCommands[ws.key] ?? { cmd: "pnpm", args: ["run", "build"] };
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
    await run("pnpm", ["install"], {
      cwd: findWorkspaceRoot(opts.configDir)?.dir ?? opts.configDir,
    });
  }

  // Prerequisite train: every target's local workspace deps get fresh dists
  // before the target builds (runtime subpaths resolve from dist — ADR 0018;
  // bundler-config factories resolve from src, so the config chain cannot go
  // stale). Fresh members no-op; failures are loud. Deploy prerequisite
  // builds run in the same build mode as the target builds below — one env
  // contract for every deploy build child.
  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: opts.deploy ? "production" : "development",
  };
  // Dist-first deploy builds (ADR 0018): a deploy build must never inherit a
  // DEPLOY value from the operator's shell, and a dev build must never see one.
  if (opts.deploy) env.DEPLOY = "true";
  else delete env.DEPLOY;

  const depsReport = await ensureFreshDeps(
    opts.configDir,
    existing.map((entry) => entry.path),
    { force: opts.deploy, env },
  );
  if (depsReport.rebuilt.length > 0) {
    console.log(
      `  ${colors.dim(`prerequisites: rebuilt ${depsReport.rebuilt.map((member) => member.name).join(", ")}`)}`,
    );
  }

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
          error: describeError(result.reason),
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
        cmd: "pnpm",
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
