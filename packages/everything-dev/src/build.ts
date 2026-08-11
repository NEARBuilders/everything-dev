import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { formatDuration } from "./cli/timing";
import { resolveLocalDevelopmentPath } from "./config";
import { findBosConfigPathInDir } from "./config-source";
import type { WorkspaceDeployResult } from "./contract";
import { applyDeployResults, type DeployResultEntry, parseDeployLines } from "./integrity";
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

type WorkspaceTarget = {
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

function resolveWorkspaceTarget(
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

  return packages
    .split(",")
    .map((pkg) => pkg.trim())
    .filter((pkg) => allPackages.includes(pkg));
}

interface BuildAttemptResult {
  success: boolean;
  url?: string;
  error?: string;
  warnings?: string[];
  exitCode: number;
  output: string;
  deployEntries?: DeployResultEntry[];
}

async function runBuildAttempt(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  verbose: boolean,
): Promise<BuildAttemptResult> {
  const result = await run(cmd, args, {
    cwd,
    env,
    capture: true,
    onChunk: (stream, chunk) => {
      if (stream === "stderr") {
        process.stderr.write(chunk);
      } else if (verbose) {
        process.stdout.write(chunk);
      }
      const text = chunk.toString("utf-8");
      if (/ZEPHYR|auth\.zephyr-cloud\.io\/authorize|ZE\d{4,}/.test(text)) {
        process.stdout.write(chunk);
      }
    },
  });
  const stdout = result?.stdout ?? "";
  const stderr = result?.stderr ?? "";
  const exitCode = result?.exitCode ?? 0;
  const output = `${stdout}\n${stderr}`;

  const deployEntries = parseDeployLines(output);

  if (deployEntries.length > 0) {
    const result: BuildAttemptResult = {
      success: true,
      url: deployEntries[0]?.url,
      exitCode: 0,
      output,
      deployEntries,
    };
    if (exitCode !== 0) {
      const errorLines = output
        .split("\n")
        .filter((line) => /\bERROR\b/.test(line) || line.startsWith("Rspack compiled with"))
        .slice(0, 5);
      if (errorLines.length > 0) {
        result.warnings = errorLines.map((l) => l.trim());
        if (!verbose) {
          console.log(
            `  ${colors.yellow("⚠")} Build completed with errors (exit code ${exitCode}) — Zephyr deployed successfully`,
          );
          for (const line of errorLines) {
            console.log(`    ${colors.dim(line.trim())}`);
          }
        }
      }
    }
    return result;
  }

  if (exitCode !== 0) {
    const lastLines = output.trim().split("\n").slice(-5).join("\n");
    return {
      success: false,
      error: `Build failed (exit code ${exitCode})\n${lastLines}`,
      exitCode,
      output,
    };
  }

  const deployMatch = output.match(/🚀.*Deployed:\s*(https?:\S+)/);
  if (deployMatch) {
    return { success: true, url: deployMatch[1], exitCode: 0, output };
  }

  const zeMatch = output.match(/ZE\d{4,}/);
  if (zeMatch) {
    const zeLines = output
      .split("\n")
      .filter((l) => /ZEPHYR|ZE\d{4,}/.test(l))
      .slice(0, 5);
    const detail = zeLines.length > 0 ? `\n${zeLines.join("\n")}` : "";
    return {
      success: false,
      error: `Zephyr upload failed (${zeMatch[0]})${detail}`,
      exitCode: 0,
      output,
    };
  }

  if (env.DEPLOY === "true") {
    return {
      success: false,
      error: "No deploy URL found (Zephyr may have failed)",
      exitCode: 0,
      output,
    };
  }
  return { success: true, exitCode: 0, output };
}

interface InternalWorkspaceResult extends WorkspaceDeployResult {
  deployEntries?: DeployResultEntry[];
}

async function buildOneWorkspace(
  ws: WorkspaceTarget,
  env: Record<string, string>,
  opts: { deploy: boolean; verbose?: boolean },
): Promise<InternalWorkspaceResult> {
  const pkgJson = await readJsonFile<{
    scripts?: Record<string, string>;
  }>(`${ws.path}/package.json`);
  const shouldDeployScript = opts.deploy && pkgJson.scripts?.deploy;
  const buildConfig = shouldDeployScript
    ? { cmd: "bun", args: ["run", "deploy"] }
    : (buildCommands[ws.key] ?? { cmd: "bun", args: ["run", "build"] });

  const wsEnv = { ...env };

  const startTime = Date.now();
  let attempt = await runBuildAttempt(
    buildConfig.cmd,
    buildConfig.args,
    ws.path,
    wsEnv,
    opts.verbose ?? false,
  );

  let retried = false;
  const firstAttempt: BuildAttemptResult | undefined = attempt.success ? undefined : { ...attempt };

  if (!attempt.success && attempt.exitCode === 0 && opts.deploy) {
    if (!opts.verbose) {
      console.log(`  ${colors.yellow("↻")} ${padRight(ws.key, 28)} retrying...`);
    }
    retried = true;
    attempt = await runBuildAttempt(
      buildConfig.cmd,
      buildConfig.args,
      ws.path,
      wsEnv,
      opts.verbose ?? false,
    );

    if (!attempt.success && firstAttempt) {
      attempt.error = `First attempt: ${firstAttempt.error}\nRetry: ${attempt.error}`;
    }
  }

  const durationMs = Date.now() - startTime;
  const result: InternalWorkspaceResult = {
    key: ws.key,
    kind: ws.kind,
    success: attempt.success,
    url: attempt.url,
    error: attempt.error,
    warnings: attempt.warnings,
    deployEntries: attempt.deployEntries,
    durationMs,
    retried: retried ? true : undefined,
  };

  if (!opts.verbose) {
    const name = padRight(ws.key, 28);
    if (result.success) {
      const duration = formatDuration(durationMs);
      const retryTag = retried ? " (retried)" : "";
      console.log(`  ${colors.green(icons.ok)} ${name} ${colors.dim(duration + retryTag)}`);
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

  const shouldBuildPlugin = existing.some((entry) => entry.key === "api");

  const forceRebuild = opts.deploy;
  const buildTasks: Promise<void>[] = [buildEverythingDevQuietly(opts.configDir, forceRebuild)];
  if (shouldBuildPlugin) {
    buildTasks.push(buildEveryPluginQuietly(opts.configDir, forceRebuild));
  }
  await Promise.all(buildTasks);

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: opts.deploy ? "production" : "development",
  };
  if (opts.deploy) {
    env.DEPLOY = "true";
  } else {
    delete env.DEPLOY;
  }

  const bosConfigPath =
    findBosConfigPathInDir(opts.configDir) ?? join(opts.configDir, "bos.config.json");
  let configSnapshot: string | undefined;
  if (opts.deploy && existsSync(bosConfigPath)) {
    configSnapshot = readFileSync(bosConfigPath, "utf-8");
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

    const allDeployEntries: DeployResultEntry[] = [];
    for (let i = 0; i < parallelGroup.length; i++) {
      const ws = parallelGroup[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        if (result.value.success) {
          built.push(ws.key);
        }
        if (result.value.deployEntries) {
          allDeployEntries.push(...result.value.deployEntries);
        }
        const { deployEntries: _deployEntries, ...deployResult } = result.value;
        deployResults.push(deployResult);
      } else {
        deployResults.push({
          key: ws.key,
          kind: ws.kind,
          success: false,
          error: result.reason?.message ?? "Unknown error",
        });
      }
    }

    if (configSnapshot && allDeployEntries.length > 0) {
      const config = JSON.parse(configSnapshot) as Record<string, unknown>;
      const merged = applyDeployResults(config, allDeployEntries);
      writeFileSync(bosConfigPath, `${JSON.stringify(merged, null, 2)}\n`);
    }

    for (const ws of sequentialGroup) {
      const result = await buildOneWorkspace(ws, env, opts);
      if (result.success) {
        built.push(ws.key);
      }
      if (result.deployEntries) {
        const hostEntries = result.deployEntries.filter((r) => r.urlField.startsWith("app.host"));
        if (hostEntries.length > 0 && existsSync(bosConfigPath)) {
          const currentConfig = JSON.parse(readFileSync(bosConfigPath, "utf-8")) as Record<
            string,
            unknown
          >;
          const merged = applyDeployResults(currentConfig, hostEntries);
          writeFileSync(bosConfigPath, `${JSON.stringify(merged, null, 2)}\n`);
        }
      }
      const { deployEntries: _deployEntries, ...sequentialResult } = result;
      deployResults.push(sequentialResult);
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

  const distPath = `${cwd}/packages/every-plugin/dist/build/rspack/plugin.mjs`;
  const distExists = await fileExists(distPath);

  if (distExists && !force) {
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

export async function buildEverythingDevQuietly(cwd: string, force = false) {
  const packageDir = `${cwd}/packages/everything-dev`;
  const packageExists = await fileExists(`${packageDir}/package.json`);
  if (!packageExists) {
    return;
  }

  const distPath = `${cwd}/packages/everything-dev/dist/index.mjs`;
  const distExists = await fileExists(distPath);

  if (distExists && !force) {
    return;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/everything-dev", "build"], {
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
    `bun run --cwd packages/everything-dev build failed with exit code ${result.exitCode}`,
  );
}
