import { access, readFile } from "node:fs/promises";
import process from "node:process";
import { Context, Effect, Layer, Option } from "effect";
import { resolveLocalDevelopmentPath } from "../../config";
import type { WorkspaceDeployResult } from "../../contract";
import { syncResolvedSharedDeps } from "../../shared-deps";
import type { BosConfig, BosPluginRef, RuntimeConfig } from "../../types";
import { run } from "../../utils/run";
import { ensureFreshDeps, findWorkspaceRoot } from "../../workspace";

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

export type WorkspaceBuildOutcome = {
  key: string;
  kind: "app" | "plugin";
  success: boolean;
  error?: string;
  durationMs: number;
  stderr: string;
  /** Warning segments extracted from the build's own output — attributed to
   * this workspace and rendered in the Build section, never interleaved raw. */
  warnings: string[];
};

/** Render events the build train emits (#424) — the ✓/✗ table, the deploy
 * banner, and the prerequisite line are presentation: the service only
 * decides WHEN, `cli/render/workspace-build` decides HOW. */
export interface WorkspaceBuildRender {
  banner?(total: number): void;
  prerequisites?(names: readonly string[]): void;
  outcome?(outcome: WorkspaceBuildOutcome): void;
  end?(): void;
}

export interface BuildTargetsInput {
  configDir: string;
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  targets: string[];
  deploy: boolean;
  verbose?: boolean;
}

export interface BuildTargetsDeps {
  runChild?: typeof run;
  freshDeps?: typeof ensureFreshDeps;
  fileExists?: typeof fileExists;
  render?: WorkspaceBuildRender;
}

export interface BuildTargetsResult {
  built: string[];
  skipped: string[];
  deployResults?: WorkspaceDeployResult[];
}

/** Pulls warning segments out of a build's stderr: a WARNING/⚠ line opens a
 * segment that runs to the next blank line; `$ ` command echoes never count. */
export function extractBuildWarnings(stderr: string): string[] {
  const warnings: string[] = [];
  let current: string[] | null = null;
  for (const line of stderr.split("\n")) {
    if (current === null) {
      if (!/^\$\s/.test(line.trim()) && /WARNING|⚠|\bwarning\b/i.test(line)) {
        current = [line];
      }
    } else if (line.trim() === "") {
      if (current.some((l) => l.trim().length > 0)) warnings.push(current.join("\n"));
      current = null;
    } else {
      current.push(line);
    }
  }
  if (current?.some((l) => l.trim().length > 0)) warnings.push(current.join("\n"));
  return warnings;
}

async function buildOneWorkspace(
  ws: WorkspaceTarget,
  env: Record<string, string>,
  opts: { verbose?: boolean },
  deps: BuildTargetsDeps,
): Promise<WorkspaceBuildOutcome> {
  const buildConfig = buildCommands[ws.key] ?? { cmd: "pnpm", args: ["run", "build"] };
  const verbose = opts.verbose ?? false;
  const startTime = Date.now();
  const stderrBuffer: string[] = [];

  const proc = await (deps.runChild ?? run)(buildConfig.cmd, buildConfig.args, {
    cwd: ws.path,
    env,
    capture: true,
    onChunk: (stream, chunk) => {
      if (stream === "stderr") {
        // Raw streaming is verbose-only; by default stderr is buffered and
        // surfaced attributed — as warnings in the Build section (#431).
        if (verbose) process.stderr.write(chunk);
        stderrBuffer.push(chunk.toString());
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
    stderr: proc?.stderr ?? "",
    warnings: extractBuildWarnings(`${stderrBuffer.join("")}${proc?.stderr ?? ""}`),
    ...(exitCode !== 0 && {
      error: `Build failed (exit code ${exitCode})\n${output.trim().split("\n").slice(-5).join("\n")}`,
    }),
    durationMs,
  };

  if (!verbose) deps.render?.outcome?.(result);

  return result;
}

export async function buildWorkspaceTargets(
  input: BuildTargetsInput,
  deps: BuildTargetsDeps = {},
): Promise<BuildTargetsResult> {
  const render = deps.render;
  const existing: WorkspaceTarget[] = [];
  const skipped: string[] = [];

  for (const target of input.targets) {
    const resolved = resolveWorkspaceTarget(
      target,
      input.bosConfig,
      input.runtimeConfig,
      input.configDir,
    );
    if (!resolved) {
      skipped.push(target);
      continue;
    }

    const exists = await (deps.fileExists ?? fileExists)(`${resolved.path}/package.json`);
    if (exists) existing.push(resolved);
    else skipped.push(target);
  }

  if (existing.length === 0) {
    return { built: [], skipped };
  }

  const sharedSync = await syncResolvedSharedDeps({
    configDir: input.configDir,
    hostMode: "local",
    bosConfig: input.bosConfig ?? undefined,
    extendsChain: [],
  });
  if (sharedSync.catalogChanged) {
    await run("pnpm", ["install"], {
      cwd: findWorkspaceRoot(input.configDir)?.dir ?? input.configDir,
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
    NODE_ENV: input.deploy ? "production" : "development",
  };
  // Dist-first deploy builds (ADR 0018): a deploy build must never inherit a
  // DEPLOY value from the operator's shell, and a dev build must never see one.
  if (input.deploy) env.DEPLOY = "true";
  else delete env.DEPLOY;

  const depsReport = await (deps.freshDeps ?? ensureFreshDeps)(
    input.configDir,
    existing.map((entry) => entry.path),
    { force: input.deploy, env },
  );
  if (depsReport.rebuilt.length > 0) {
    render?.prerequisites?.(depsReport.rebuilt.map((member) => member.name));
  }

  const orderedExisting = input.deploy
    ? [
        ...existing.filter((entry) => entry.kind === "app" && entry.key !== "host"),
        ...existing.filter((entry) => entry.kind === "plugin"),
        ...existing.filter((entry) => entry.kind === "app" && entry.key === "host"),
      ]
    : existing;

  const parallelGroup = input.deploy
    ? orderedExisting.filter((e) => e.key !== "host")
    : orderedExisting;
  const sequentialGroup = input.deploy ? orderedExisting.filter((e) => e.key === "host") : [];

  const built: string[] = [];
  const deployResults: WorkspaceDeployResult[] = [];

  if (input.deploy && parallelGroup.length > 0) {
    const total = parallelGroup.length + sequentialGroup.length;
    render?.banner?.(total);

    const results = await Promise.allSettled(
      parallelGroup.map((ws) => buildOneWorkspace(ws, env, input, deps)),
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
          warnings: [],
        });
      }
    }

    for (const ws of sequentialGroup) {
      const result = await buildOneWorkspace(ws, env, input, deps);
      if (result.success) {
        built.push(ws.key);
      }
      deployResults.push(result);
    }

    render?.end?.();
  } else {
    for (const resolved of orderedExisting) {
      const buildConfig = buildCommands[resolved.key] ?? {
        cmd: "pnpm",
        args: ["run", "build"],
      };

      await (deps.runChild ?? run)(buildConfig.cmd, buildConfig.args, {
        cwd: resolved.path,
        env,
      });
      built.push(resolved.key);
    }
  }

  return { built, skipped, deployResults: input.deploy ? deployResults : undefined };
}

/** Presentation seam the composition root wires to `cli/render` (#424). */
export class WorkspaceBuildRenderService extends Context.Service<
  WorkspaceBuildRenderService,
  WorkspaceBuildRender
>()("everything-dev/workspace/build-render") {}

/**
 * The build train as a Context.Service (ticket #424): parallel/sequential
 * group logic and the prerequisite train behind one tag; the ✓ table renders
 * through the composition root's render, never the service.
 */
export class BuildTrainService extends Context.Service<
  BuildTrainService,
  {
    buildTargets: (
      input: BuildTargetsInput,
      deps?: BuildTargetsDeps,
    ) => Promise<BuildTargetsResult>;
  }
>()("everything-dev/workspace/build-train") {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const renderOption = yield* Effect.serviceOption(WorkspaceBuildRenderService);
      return BuildTrainService.of({
        buildTargets: (input, deps) =>
          buildWorkspaceTargets(input, {
            ...deps,
            render: deps?.render ?? Option.getOrUndefined(renderOption),
          }),
      });
    }),
  );
}
