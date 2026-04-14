import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect } from "effect";
import { syncApiContractBridge } from "./api-contract";
import { buildRuntimeConfig, detectLocalPackages, prepareDevelopmentRuntimeConfig } from "./app";
import {
  buildRuntimePluginsForConfig,
  getHostDevelopmentPort,
  getProjectRoot,
  loadConfig,
  parsePort,
  resolveDevelopmentHostUrl,
  resolveLocalDevelopmentPath,
} from "./config";
import {
  type BosConfigResult,
  type BuildOptions,
  bosContract,
  type DevOptions,
  type KeyPublishOptions,
  type PluginAddOptions,
  type PluginListResult,
  type PluginPublishOptions,
  type PluginRemoveOptions,
  type PublishOptions,
  type StartOptions,
} from "./contract";
import { type AppConfig, type AppOrchestrator, startApp } from "./dev-session";
import {
  buildRegistryConfigUrlForNetwork,
  fetchBosConfigFromFastKv,
  getRegistryNamespaceForAccount,
  getRegistryNamespaceForNetwork,
} from "./fastkv";
import { addFunctionCallAccessKey, ensureNearCli, executeTransaction } from "./near-cli";
import { getNetworkIdForAccount } from "./network";
import { createPlugin, z } from "./sdk";
import { syncAndGenerateSharedUi } from "./shared";
import type { BosConfig, RuntimeConfig, SourceMode } from "./types";
import { run } from "./utils/run";

const DEFAULT_DEV_CONFIG: AppConfig = {
  host: "local",
  ui: "local",
  api: "local",
  ssr: false,
};

const buildCommands: Record<string, { cmd: string; args: string[] }> = {
  host: { cmd: "bun", args: ["run", "build"] },
  ui: { cmd: "bun", args: ["run", "build"] },
  api: { cmd: "bun", args: ["run", "build"] },
};

const PUBLISH_FUNCTION_NAMES = ["__fastdata_kv"];

type BosDeps = {
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  configDir: string;
};

type PluginAttachmentConfig = NonNullable<BosConfig["plugins"]>[string];

function parseSourceMode(value: string | undefined, defaultValue: SourceMode): SourceMode {
  if (value === "local" || value === "remote") return value;
  return defaultValue;
}

function buildAppConfig(options: {
  host?: string;
  ui?: string;
  api?: string;
  proxy?: boolean;
  ssr?: boolean;
}): AppConfig {
  return {
    host: parseSourceMode(options.host, DEFAULT_DEV_CONFIG.host),
    ui: parseSourceMode(options.ui, DEFAULT_DEV_CONFIG.ui),
    api: parseSourceMode(options.api, DEFAULT_DEV_CONFIG.api),
    proxy: options.proxy,
    ssr: options.ssr ?? DEFAULT_DEV_CONFIG.ssr,
  };
}

function buildDescription(config: AppConfig): string {
  if (config.host === "local" && config.ui === "local" && config.api === "local" && !config.proxy) {
    return "Full Local Development";
  }

  const parts: string[] = [];
  parts.push(config.host === "remote" ? "Remote Host" : "Local Host");
  if (config.ui === "remote") parts.push("Remote UI");
  if (config.proxy) parts.push("Proxy API → Production");
  else if (config.api === "remote") parts.push("Remote API");
  return parts.join(" + ");
}

function buildConfigResult(bosConfig: BosConfig | null): BosConfigResult {
  const packages = bosConfig ? Object.keys(bosConfig.app) : [];
  const remotes = packages.filter((name) => name !== "host");

  return {
    config: bosConfig,
    packages,
    remotes,
  };
}

type WorkspaceTarget = {
  key: string;
  kind: "app" | "plugin";
  path: string;
};

function resolveWorkspaceTarget(
  key: string,
  bosConfig: BosConfig | null,
  runtimeConfig: RuntimeConfig | null,
  configDir: string,
): WorkspaceTarget | null {
  if (bosConfig?.app && key in bosConfig.app) {
    return {
      key,
      kind: "app",
      path: `${configDir}/${key}`,
    };
  }

  const runtimePlugin = runtimeConfig?.plugins?.[key];
  const pluginPath =
    runtimePlugin?.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.plugins?.[key]?.development, configDir);
  if (pluginPath) {
    return {
      key,
      kind: "plugin",
      path: pluginPath,
    };
  }

  return null;
}

function determineProcesses(
  config: AppConfig,
  localPackages: string[],
  runtimeConfig?: RuntimeConfig | null,
): string[] {
  const processes: string[] = [];
  if (config.ssr && config.ui === "local") processes.push("ui-ssr");
  if (config.ui === "local") processes.push("ui");
  if (config.api === "local" && !config.proxy) processes.push("api");
  for (const pkg of localPackages) {
    if (pkg.startsWith("plugin:")) {
      const pluginId = pkg.slice("plugin:".length);
      if (runtimeConfig?.plugins?.[pluginId]?.source === "local") {
        processes.push(pkg);
      }
    }
  }
  processes.push("host");
  return processes;
}

function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveProxyUrl(bosConfig: BosConfig | null): string | null {
  if (!bosConfig) return null;
  const apiConfig = bosConfig.app.api;
  if (!apiConfig) return null;
  if (apiConfig.proxy && isValidProxyUrl(apiConfig.proxy)) return apiConfig.proxy;
  if (apiConfig.production && isValidProxyUrl(apiConfig.production)) return apiConfig.production;
  return null;
}

function sanitizePluginKey(value: string): string {
  return value
    .replace(/[^A-Za-z0-9/_-]/g, "-")
    .replace(/\/+/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, "-"))
    .join("/")
    .replace(/^\/+|\/+$/g, "");
}

function defaultPluginKey(source: string): string {
  const normalized = source.replace(/^local:/, "").replace(/\/$/, "");
  if (source.startsWith("local:")) {
    return sanitizePluginKey(basename(normalized)) || "plugin";
  }

  try {
    const url = new URL(source);
    return sanitizePluginKey(basename(url.pathname) || url.hostname) || "plugin";
  } catch {
    return sanitizePluginKey(source) || "plugin";
  }
}

function pluginLocalPath(configDir: string, attachment: PluginAttachmentConfig): string | null {
  const source = attachment.development ?? attachment.production;
  if (!source?.startsWith("local:")) {
    return null;
  }

  return join(configDir, source.slice("local:".length));
}

async function saveBosConfig(configDir: string, config: BosConfig): Promise<void> {
  const filePath = join(configDir, "bos.config.json");
  const next = `${JSON.stringify(config, null, 2)}\n`;
  try {
    if (readFileSync(filePath, "utf8") === next) return;
  } catch {
    // file does not exist yet
  }

  writeFileSync(filePath, next);
}

function listPluginAttachments(config: BosConfig | null) {
  return (Object.entries(config?.plugins ?? {}) as Array<[string, PluginAttachmentConfig]>)
    .map(([key, attachment]) => ({
      key,
      development: attachment.development,
      production: attachment.production,
      localPath: attachment.development?.startsWith("local:")
        ? attachment.development.slice("local:".length)
        : undefined,
      source: attachment.development?.startsWith("local:")
        ? ("local" as const)
        : ("remote" as const),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function refreshApiContractBridge(configDir: string): Promise<void> {
  const refreshed = await loadConfig({ cwd: configDir, env: "development" });
  if (!refreshed) return;

  await syncApiContractBridge({
    configDir,
    runtimeConfig: refreshed.runtime,
    apiBaseUrl: refreshed.runtime.api.url,
  });
}

function extractPublishedUrl(output: string): string | null {
  const match = output.match(/https?:\/\/[^\s"'<>]+/g);
  if (!match || match.length === 0) return null;
  return match[match.length - 1] ?? null;
}

async function buildEnvVars(
  config: AppConfig,
  bosConfig?: BosConfig | null,
): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    HOST_SOURCE: config.host,
    UI_SOURCE: config.ui,
    API_SOURCE: config.api,
  };

  if (config.host === "remote") {
    const remoteUrl = bosConfig?.app.host.production;
    if (remoteUrl) env.HOST_REMOTE_URL = remoteUrl;
  }

  if (config.ui === "remote") {
    const remoteUrl = bosConfig?.app.ui.production;
    if (remoteUrl) env.UI_REMOTE_URL = remoteUrl;
  }

  if (config.api === "remote") {
    const remoteUrl = bosConfig?.app.api.production;
    if (remoteUrl) env.API_REMOTE_URL = remoteUrl;
  }

  if (config.proxy && bosConfig) {
    const proxyUrl = resolveProxyUrl(bosConfig);
    if (proxyUrl) env.API_PROXY = proxyUrl;
  }

  return env;
}

async function buildEveryPluginQuietly(cwd: string) {
  const distPath = `${cwd}/packages/every-plugin/dist/build/rspack/plugin.mjs`;
  const distExists = await Bun.file(distPath).exists();

  if (distExists) {
    return;
  }

  const result = (await run("bun", ["run", "--cwd", "packages/every-plugin", "build"], {
    cwd,
    capture: true,
  })) as { stdout: string; stderr: string; exitCode: number };

  if (result.exitCode === 0) {
    console.log("[build:ssr] build succeeded");
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

async function fetchPublishedConfig(
  accountId: string,
  gatewayId: string,
): Promise<BosConfig | null> {
  try {
    return await fetchBosConfigFromFastKv<BosConfig>(`bos://${accountId}/${gatewayId}`);
  } catch {
    return null;
  }
}

function selectWorkspaceTargets(packages: string, bosConfig: BosConfig | null): string[] {
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

async function buildWorkspaceTargets(opts: {
  configDir: string;
  bosConfig: BosConfig | null;
  runtimeConfig: RuntimeConfig | null;
  targets: string[];
  deploy: boolean;
}): Promise<{ built: string[]; skipped: string[] }> {
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

    const exists = await Bun.file(`${resolved.path}/package.json`).exists();
    if (exists) existing.push(resolved);
    else skipped.push(target);
  }

  if (existing.length === 0) {
    return { built: [], skipped };
  }

  const sharedSync = await syncAndGenerateSharedUi({
    configDir: opts.configDir,
    hostMode: "local",
  });
  if (sharedSync.catalogChanged) {
    await run("bun", ["install"], { cwd: opts.configDir });
  }

  if (existing.some((entry) => entry.key === "api")) {
    await buildEveryPluginQuietly(opts.configDir);
  }

  const env: Record<string, string> = {
    ...process.env,
    NODE_ENV: opts.deploy ? "production" : "development",
  };
  if (opts.deploy) {
    env.DEPLOY = "true";
  } else {
    delete env.DEPLOY;
  }

  const orderedExisting = opts.deploy
    ? [
        ...existing.filter((entry) => entry.kind === "app" && entry.key !== "host"),
        ...existing.filter((entry) => entry.kind === "plugin"),
        ...existing.filter((entry) => entry.kind === "app" && entry.key === "host"),
      ]
    : existing;
  const built: string[] = [];

  for (const resolved of orderedExisting) {
    const pkgJson = JSON.parse(await Bun.file(`${resolved.path}/package.json`).text()) as {
      scripts?: Record<string, string>;
    };
    const shouldDeployScript = opts.deploy && pkgJson.scripts?.deploy;
    const buildConfig = shouldDeployScript
      ? { cmd: "bun", args: ["run", "deploy"] }
      : (buildCommands[resolved.key] ?? { cmd: "bun", args: ["run", "build"] });

    await run(buildConfig.cmd, buildConfig.args, {
      cwd: resolved.path,
      env,
    });
    built.push(resolved.key);
  }

  return { built, skipped };
}

export default createPlugin({
  variables: z.object({
    configPath: z.string().optional(),
  }),
  secrets: z.object({}),
  contract: bosContract,
  initialize: (config: any) =>
    Effect.promise(async () => {
      const configResult = await loadConfig({ path: config.variables.configPath });
      return {
        bosConfig: configResult?.config ?? null,
        runtimeConfig: configResult?.runtime ?? null,
        configDir: getProjectRoot(),
      } satisfies BosDeps;
    }),
  shutdown: () => Effect.void,
  createRouter: (deps: BosDeps, builder: any) => ({
    config: builder.config.handler(async () => buildConfigResult(deps.bosConfig)),

    pluginAdd: builder.pluginAdd.handler(async ({ input }: { input: PluginAddOptions }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          key: "",
          error: "No bos.config.json found",
        };
      }

      const key = sanitizePluginKey(input.as ?? defaultPluginKey(input.source));
      const existing = deps.bosConfig.plugins?.[key];
      const nextPlugins = { ...(deps.bosConfig.plugins ?? {}) };

      nextPlugins[key] = input.source.startsWith("local:")
        ? {
            ...(existing ?? {}),
            development: input.source,
            production: input.production ?? existing?.production,
          }
        : {
            ...(existing ?? {}),
            production: input.production ?? input.source,
          };

      deps.bosConfig = {
        ...deps.bosConfig,
        plugins: nextPlugins,
      };

      await saveBosConfig(deps.configDir, deps.bosConfig);
      await refreshApiContractBridge(deps.configDir);

      return {
        status: "added" as const,
        key,
        development: deps.bosConfig.plugins?.[key]?.development,
        production: deps.bosConfig.plugins?.[key]?.production,
      };
    }),

    pluginRemove: builder.pluginRemove.handler(
      async ({ input }: { input: PluginRemoveOptions }) => {
        if (!deps.bosConfig) {
          return {
            status: "error" as const,
            key: input.key,
            error: "No bos.config.json found",
          };
        }

        if (!deps.bosConfig.plugins?.[input.key]) {
          return {
            status: "error" as const,
            key: input.key,
            error: `Plugin '${input.key}' is not configured`,
          };
        }

        const nextPlugins = { ...(deps.bosConfig.plugins ?? {}) };
        delete nextPlugins[input.key];
        deps.bosConfig = {
          ...deps.bosConfig,
          plugins: Object.keys(nextPlugins).length > 0 ? nextPlugins : undefined,
        };

        await saveBosConfig(deps.configDir, deps.bosConfig);
        await refreshApiContractBridge(deps.configDir);

        return {
          status: "removed" as const,
          key: input.key,
        };
      },
    ),

    pluginList: builder.pluginList.handler(async () => {
      const plugins: PluginListResult["plugins"] = listPluginAttachments(deps.bosConfig);
      return {
        status: "listed" as const,
        plugins,
      };
    }),

    pluginPublish: builder.pluginPublish.handler(
      async ({ input }: { input: PluginPublishOptions }) => {
        if (!deps.bosConfig) {
          return {
            status: "error" as const,
            key: input.key,
            error: "No bos.config.json found",
          };
        }

        const attachment = deps.bosConfig.plugins?.[input.key];
        if (!attachment) {
          return {
            status: "error" as const,
            key: input.key,
            error: `Plugin '${input.key}' is not configured`,
          };
        }

        const localPath = pluginLocalPath(deps.configDir, attachment);
        if (!localPath) {
          return {
            status: "error" as const,
            key: input.key,
            error: `Plugin '${input.key}' does not have a local development path`,
          };
        }

        const pkgPath = join(localPath, "package.json");
        if (!(await Bun.file(pkgPath).exists())) {
          return {
            status: "error" as const,
            key: input.key,
            error: `Missing package.json at ${localPath}`,
          };
        }

        const pkgJson = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
        const script = pkgJson.scripts?.deploy ? "deploy" : "build";

        const { stdout, stderr, exitCode } = (await run("bun", ["run", script], {
          cwd: localPath,
          capture: true,
        })) as { stdout: string; stderr: string; exitCode: number };

        if (exitCode !== 0) {
          if (stdout.trim()) process.stdout.write(stdout);
          if (stderr.trim()) process.stderr.write(stderr);
          return {
            status: "error" as const,
            key: input.key,
            error: `Publish failed with exit code ${exitCode}`,
          };
        }

        if (stdout.trim()) process.stdout.write(stdout);
        if (stderr.trim()) process.stderr.write(stderr);

        const publishedUrl = extractPublishedUrl(`${stdout}\n${stderr}`);
        if (publishedUrl) {
          deps.bosConfig = {
            ...deps.bosConfig,
            plugins: {
              ...(deps.bosConfig.plugins ?? {}),
              [input.key]: {
                ...(deps.bosConfig.plugins?.[input.key] ?? {}),
                production: publishedUrl,
              },
            },
          };
          await saveBosConfig(deps.configDir, deps.bosConfig);
          await refreshApiContractBridge(deps.configDir);
        }

        return {
          status: "published" as const,
          key: input.key,
          path: localPath,
          script,
          production: publishedUrl ?? attachment.production,
        };
      },
    ),

    dev: builder.dev.handler(async ({ input }: { input: DevOptions }) => {
      const localPackages = detectLocalPackages(
        deps.bosConfig ?? undefined,
        deps.runtimeConfig ?? undefined,
      );

      const appConfig = buildAppConfig({
        host: localPackages.includes("host") ? (input.host as string) : "remote",
        ui: localPackages.includes("ui") ? (input.ui as string) : "remote",
        api: localPackages.includes("api") ? (input.api as string) : "remote",
        proxy: input.proxy,
        ssr: input.ssr,
      });

      const sharedSync = await syncAndGenerateSharedUi({
        configDir: deps.configDir,
        hostMode: appConfig.host,
      });
      if (sharedSync.catalogChanged) {
        await run("bun", ["install"], { cwd: deps.configDir });
      }
      if (
        (appConfig.api === "local" && !appConfig.proxy) ||
        localPackages.some((pkg) => pkg.startsWith("plugin:"))
      ) {
        await buildEveryPluginQuietly(deps.configDir);
      }

      const refreshed = await loadConfig({ cwd: deps.configDir });
      deps.bosConfig = refreshed?.config ?? deps.bosConfig;
      deps.runtimeConfig = refreshed?.runtime ?? deps.runtimeConfig;

      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          description: "No bos.config.json found",
          processes: [],
        };
      }

      if (appConfig.proxy && !resolveProxyUrl(deps.bosConfig)) {
        return {
          status: "error" as const,
          description: "No valid proxy URL configured in bos.config.json",
          processes: [],
        };
      }

      const refreshedLocalPackages = detectLocalPackages(
        deps.bosConfig ?? undefined,
        deps.runtimeConfig ?? undefined,
      );
      const processes = determineProcesses(appConfig, refreshedLocalPackages, deps.runtimeConfig);
      const env = await buildEnvVars(appConfig, deps.bosConfig);
      const hostPort = input.port ?? getHostDevelopmentPort(deps.bosConfig.app.host.development);
      const developmentRuntime = buildRuntimeConfig(deps.bosConfig, {
        uiSource: appConfig.ui,
        apiSource: appConfig.api,
        hostUrl: `http://localhost:${hostPort}`,
        proxy: env.API_PROXY,
        env: "development",
        plugins: deps.runtimeConfig?.plugins,
      });
      const runtimeConfig = await prepareDevelopmentRuntimeConfig(developmentRuntime, {
        hostPort,
        ssr: appConfig.ssr,
      });

      await syncApiContractBridge({
        configDir: deps.configDir,
        runtimeConfig: runtimeConfig,
        apiBaseUrl: runtimeConfig.api.url,
      });

      const orchestrator: AppOrchestrator = {
        packages: processes,
        env,
        description: buildDescription(appConfig),
        appConfig,
        bosConfig: deps.bosConfig,
        runtimeConfig,
        port: parsePort(runtimeConfig.hostUrl),
        interactive: input.interactive,
      };

      startApp(orchestrator);

      return {
        status: "started" as const,
        description: orchestrator.description,
        processes,
      };
    }),

    start: builder.start.handler(async ({ input }: { input: StartOptions }) => {
      let remoteConfig: BosConfig | null = null;
      if (input.account && input.domain) {
        remoteConfig = await fetchPublishedConfig(input.account, input.domain);
        if (!remoteConfig) {
          return {
            status: "error" as const,
            url: "",
          };
        }
      }

      const config = remoteConfig || deps.bosConfig;
      if (!config) {
        return {
          status: "error" as const,
          url: "",
        };
      }

      const port = input.port ?? getHostDevelopmentPort(config.app.host.development);
      const appConfig: AppConfig = { host: "remote", ui: "remote", api: "remote" };
      const env = await buildEnvVars(appConfig, config);
      const runtimePlugins = remoteConfig
        ? await buildRuntimePluginsForConfig(config, deps.configDir, "production")
        : deps.runtimeConfig?.plugins;
      const runtimeConfig = buildRuntimeConfig(config, {
        uiSource: "remote",
        apiSource: "remote",
        hostUrl: `http://localhost:${port}`,
        env: "production",
        plugins: runtimePlugins,
      });

      await syncApiContractBridge({
        configDir: deps.configDir,
        runtimeConfig: runtimeConfig,
        apiBaseUrl: runtimeConfig.api.url,
      });

      const orchestrator: AppOrchestrator = {
        packages: ["host"],
        env: {
          NODE_ENV: "production",
          ...env,
        },
        description: `Production Mode (${config.account})`,
        appConfig,
        bosConfig: config,
        runtimeConfig,
        port,
        interactive: input.interactive,
        noLogs: true,
      };

      startApp(orchestrator);
      return {
        status: "running" as const,
        url: `http://localhost:${port}`,
      };
    }),

    build: builder.build.handler(async ({ input }: { input: BuildOptions }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          built: [],
          skipped: [],
        };
      }

      const targets = selectWorkspaceTargets(input.packages, deps.bosConfig);
      if (targets.length === 0) {
        return {
          status: "error" as const,
          built: [],
          skipped: [],
        };
      }

      const runtimeConfig = buildRuntimeConfig(deps.bosConfig, {
        uiSource: deps.bosConfig.app.ui?.development ? "local" : "remote",
        apiSource: deps.bosConfig.app.api?.development ? "local" : "remote",
        hostUrl: resolveDevelopmentHostUrl(deps.bosConfig.app.host.development),
        env: "development",
        plugins: deps.runtimeConfig?.plugins,
      });

      await syncApiContractBridge({
        configDir: deps.configDir,
        runtimeConfig,
        apiBaseUrl: runtimeConfig.api.url,
      });

      const { built, skipped } = await buildWorkspaceTargets({
        configDir: deps.configDir,
        bosConfig: deps.bosConfig,
        runtimeConfig: runtimeConfig,
        targets,
        deploy: input.deploy,
      });

      if (built.length === 0) {
        return {
          status: "error" as const,
          built: [],
          skipped,
        };
      }

      return {
        status: "success" as const,
        built,
        skipped,
        deployed: input.deploy,
      };
    }),

    publish: builder.publish.handler(async ({ input }: { input: PublishOptions }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "No bos.config.json found",
        };
      }

      const account = deps.bosConfig.account;
      const gateway = deps.bosConfig.domain;
      if (!gateway) {
        return {
          status: "error" as const,
          registryUrl: "",
          error: "bos.config.json must define domain to publish",
        };
      }

      const network = input.network ?? getNetworkIdForAccount(account);
      const bosUrl = `bos://${account}/${gateway}`;
      const registryUrl = buildRegistryConfigUrlForNetwork(network, account, gateway);
      const targets = selectWorkspaceTargets(input.packages, deps.bosConfig);

      let publishConfig = deps.bosConfig;
      let built: string[] | undefined;
      let skipped: string[] | undefined;

      if (input.dryRun) {
        return {
          status: "dry-run" as const,
          registryUrl,
          built,
          skipped,
        };
      }

      if (input.deploy) {
        const result = await buildWorkspaceTargets({
          configDir: deps.configDir,
          bosConfig: deps.bosConfig,
          runtimeConfig: deps.runtimeConfig,
          targets,
          deploy: true,
        });
        built = result.built;
        skipped = result.skipped;

        const refreshed = await loadConfig({ cwd: deps.configDir });
        if (refreshed?.config) {
          deps.bosConfig = refreshed.config;
          deps.runtimeConfig = refreshed.runtime;
          publishConfig = refreshed.config;
        }
      }

      const payload = JSON.stringify({
        [`apps/${account}/${gateway}/bos.config.json`]: JSON.stringify(publishConfig),
      });
      const argsBase64 = Buffer.from(payload).toString("base64");
      const privateKey =
        input.privateKey || process.env.NEAR_PRIVATE_KEY || process.env.BOS_NEAR_PRIVATE_KEY;

      try {
        await Effect.runPromise(ensureNearCli);
        let txHash: string | undefined;

        try {
          const tx = await Effect.runPromise(
            executeTransaction({
              account,
              contract: getRegistryNamespaceForNetwork(network),
              method: "__fastdata_kv",
              argsBase64,
              network,
              privateKey,
              gas: "300Tgas",
              deposit: "0NEAR",
            }),
          );
          txHash = tx.txHash;
        } catch (error) {
          txHash = extractTransactionHash(error);

          if (!txHash) {
            throw error;
          }

          const verifiedConfig = await fetchBosConfigFromFastKv<BosConfig>(bosUrl);
          if (JSON.stringify(verifiedConfig) !== JSON.stringify(publishConfig)) {
            throw error;
          }
        }

        return {
          status: "published" as const,
          registryUrl,
          txHash,
          built,
          skipped,
        };
      } catch (error) {
        return {
          status: "error" as const,
          registryUrl,
          error: error instanceof Error ? error.message : "Unknown error",
          built,
          skipped,
        };
      }
    }),

    keyPublish: builder.keyPublish.handler(async ({ input }: { input: KeyPublishOptions }) => {
      if (!deps.bosConfig) {
        return {
          status: "error" as const,
          account: "",
          network: "mainnet" as const,
          contract: "",
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: "No bos.config.json found",
        };
      }

      const account = deps.bosConfig.account;
      const network = getNetworkIdForAccount(account);
      const contract = getRegistryNamespaceForAccount(account);
      try {
        await Effect.runPromise(ensureNearCli);
        const keyPair = await addFunctionCallAccessKey({
          account,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          network,
        });

        return {
          status: "published" as const,
          account,
          network,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
        };
      } catch (error) {
        return {
          status: "error" as const,
          account,
          network,
          contract,
          allowance: input.allowance,
          functionNames: PUBLISH_FUNCTION_NAMES,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
  }),
});

function extractTransactionHash(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match =
    message.match(/Transaction ID:\s*([A-Za-z0-9]+)/i) ||
    message.match(/([A-HJ-NP-Za-km-z1-9]{43,44})/);

  return match?.[1];
}
