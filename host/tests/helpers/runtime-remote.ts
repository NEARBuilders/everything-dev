import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BosConfig } from "everything-dev/types";
import { runServer } from "../../src/program";
import type { RuntimeConfig } from "../../src/services/config";
import { startJsonProxyTarget } from "./json-proxy-target";
import { getAvailablePort } from "./ports";
import { loadHostTestEnv } from "./test-env";

function getNetworkIdForAccount(account: string): "mainnet" | "testnet" {
  return account.endsWith(".testnet") ? "testnet" : "mainnet";
}

export type RuntimeRemoteScenarioName = "remote-client" | "remote-ssr" | "remote-proxy";

export interface RuntimeRemoteScenario {
  name: RuntimeRemoteScenarioName;
  title: string;
  ssr: boolean;
  proxy: boolean;
  available: boolean;
  skipReason?: string;
}

export interface RuntimeRemoteHost {
  baseUrl: string;
  config: RuntimeConfig;
  stop: () => Promise<void>;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "../../..");
const bosConfigPath = path.join(workspaceRoot, "bos.config.json");

loadHostTestEnv(workspaceRoot);

function normalizeUrl(url: string) {
  return url.replace(/\/$/, "");
}

function toMfEntry(url: string) {
  return `${normalizeUrl(url)}/mf-manifest.json`;
}

async function loadRawBosConfig(): Promise<BosConfig> {
  const raw = await readFile(bosConfigPath, "utf8");
  return JSON.parse(raw) as BosConfig;
}

function getScenarioSkipReason(config: BosConfig, scenario: RuntimeRemoteScenarioName) {
  const uiProduction = config.app?.ui?.production;
  const uiSsr = config.app?.ui?.ssr;
  const apiProduction = config.app?.api?.production;

  if (!config.account) {
    return "Missing account in bos.config.json";
  }

  if (!uiProduction) {
    return "Missing app.ui.production in bos.config.json";
  }

  if (scenario !== "remote-proxy") {
    if (!apiProduction) {
      return "Missing app.api.production in bos.config.json";
    }
  }

  if (scenario === "remote-ssr") {
    if (!uiSsr) {
      return "Missing app.ui.ssr in bos.config.json";
    }
  }

  return undefined;
}

async function getReleaseTrainSkipReason(config: BosConfig): Promise<boolean> {
  if (process.env.BOS_RUNTIME_REMOTE_ALLOW_STALE_TRAIN) return true;

  const { getPluginSharedDependencies } = (await import("every-plugin/build/rspack")) as {
    getPluginSharedDependencies: () => Record<string, { version: string }>;
  };
  const expected = new Map(
    Object.entries(getPluginSharedDependencies()).map(
      ([name, dep]) => [name, dep.version] as const,
    ),
  );

  const candidates = [
    config.app?.host?.production,
    config.app?.api?.production,
    config.app?.auth?.production,
  ]
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => normalizeUrl(url).replace(/\/mf-manifest.json$/, ""));

  for (const base of candidates) {
    let manifest: { shared?: Array<{ name: string; version?: string }> } | null = null;
    try {
      const res = await fetch(`${base}/mf-manifest.json`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        manifest = (await res.json()) as {
          shared?: Array<{ name: string; version?: string }>;
        };
      }
    } catch {
      return false;
    }
    for (const { name, version } of manifest?.shared ?? []) {
      const expectedVersion = expected.get(name);
      if (expectedVersion && version && version !== expectedVersion) {
        console.warn(
          `[SharedIdentity] Remote bundle ${base} is on a different release train ` +
            `(${name}@${version} vs local ${expectedVersion}) — remote runtime smoke suites are skipped. ` +
            `Run "bos publish --deploy --packages local" to recover, ` +
            `or set BOS_RUNTIME_REMOTE_ALLOW_STALE_TRAIN=1 to force.`,
        );
        return false;
      }
    }
  }
  return true;
}

export async function getRuntimeRemoteScenarios(): Promise<RuntimeRemoteScenario[]> {
  const config = await loadRawBosConfig();
  const trainAvailable = await getReleaseTrainSkipReason(config);
  const remoteClientSkipReason = trainAvailable
    ? getScenarioSkipReason(config, "remote-client")
    : "Remote host/plugin bundles are on a different release train than the local runtime; run `bos publish --deploy --packages local` first or set BOS_RUNTIME_REMOTE_ALLOW_STALE_TRAIN=1";
  const remoteSsrSkipReason = getScenarioSkipReason(config, "remote-ssr");
  const remoteProxySkipReason = getScenarioSkipReason(config, "remote-proxy");
  const remoteSsrTotalSkip = remoteSsrSkipReason ?? remoteClientSkipReason;

  return [
    {
      name: "remote-client",
      title: "remote ui + remote api without ssr",
      ssr: false,
      proxy: false,
      skipReason: remoteClientSkipReason,
      available: !remoteClientSkipReason,
    },
    {
      name: "remote-ssr",
      title: "remote ui + remote api with ssr",
      ssr: true,
      proxy: false,
      skipReason: remoteSsrTotalSkip,
      available: !remoteSsrTotalSkip,
    },
    {
      name: "remote-proxy",
      title: "remote ui + proxy api without ssr",
      ssr: false,
      proxy: true,
      skipReason: remoteProxySkipReason,
      available: !remoteProxySkipReason,
    },
  ];
}

function buildRuntimeConfig(
  config: BosConfig,
  scenario: RuntimeRemoteScenario,
  hostUrl: string,
  proxyTargetUrl?: string,
): RuntimeConfig {
  const uiUrl = config.app?.ui?.production;
  const apiUrl = scenario.proxy ? proxyTargetUrl : (config.app?.api?.production ?? "");

  if (!config.account || !uiUrl) {
    throw new Error(`Scenario ${scenario.name} is missing required remote config`);
  }

  const rawAuth = config.app?.auth as Record<string, unknown> | undefined;

  return {
    env: "development",
    account: config.account,
    networkId: getNetworkIdForAccount(config.account),
    title: config.account,
    repository: config.repository,
    host: {
      name: "host",
      url: hostUrl,
      entry: `${hostUrl}/mf-manifest.json`,
      source: "remote" as const,
    },
    ui: {
      name: config.app?.ui?.name ?? "ui",
      url: normalizeUrl(uiUrl),
      entry: toMfEntry(uiUrl),
      source: "remote",
      ssrUrl: scenario.ssr ? config.app?.ui?.ssr : undefined,
    },
    api: {
      name: config.app?.api?.name ?? "api",
      url: apiUrl ? normalizeUrl(apiUrl) : "",
      entry: apiUrl ? toMfEntry(apiUrl) : "",
      source: "remote",
      proxy: scenario.proxy && proxyTargetUrl ? normalizeUrl(proxyTargetUrl) : undefined,
      variables: config.app?.api?.variables,
      secrets: config.app?.api?.secrets,
      shared: config.app?.api?.shared,
    },
    auth: rawAuth?.variables
      ? {
          name: (rawAuth.name as string) ?? "auth",
          url: normalizeUrl(
            (rawAuth.production as string) ??
              (rawAuth.development as string) ??
              "http://localhost:3002",
          ),
          entry: toMfEntry(
            normalizeUrl(
              (rawAuth.production as string) ??
                (rawAuth.development as string) ??
                "http://localhost:3002",
            ),
          ),
          source: "remote" as const,
          variables: rawAuth.variables as Record<string, unknown>,
          secrets: rawAuth.secrets as string[] | undefined,
          shared: rawAuth.shared as NonNullable<RuntimeConfig["auth"]>["shared"] | undefined,
        }
      : undefined,
  } as RuntimeConfig;
}

export async function startRuntimeRemoteHost(
  scenario: RuntimeRemoteScenario,
): Promise<RuntimeRemoteHost> {
  if (!scenario.available) {
    throw new Error(scenario.skipReason ?? `Scenario ${scenario.name} is unavailable`);
  }

  const rawConfig = await loadRawBosConfig();
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proxyTarget = scenario.proxy ? await startJsonProxyTarget() : null;
  const runtimeConfig = buildRuntimeConfig(rawConfig, scenario, baseUrl, proxyTarget?.baseUrl);

  const previousNodeEnv = process.env.NODE_ENV;
  const previousHost = process.env.HOST;
  const previousPort = process.env.PORT;
  const previousIdentityMode = process.env.BOS_MF_IDENTITY;
  process.env.NODE_ENV = "development";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(port);
  process.env.BOS_MF_IDENTITY = "warn";

  if (scenario.proxy) {
    process.argv.push("--proxy");
  }

  const handle = runServer({ config: runtimeConfig });

  try {
    await handle.ready;
  } catch (error) {
    await handle.shutdown().catch(() => undefined);
    await proxyTarget?.stop().catch(() => undefined);
    process.env.NODE_ENV = previousNodeEnv;
    process.env.HOST = previousHost;
    process.env.PORT = previousPort;
    process.env.BOS_MF_IDENTITY = previousIdentityMode;

    if (scenario.proxy) {
      const proxyIdx = process.argv.indexOf("--proxy");
      if (proxyIdx !== -1) {
        process.argv.splice(proxyIdx, 1);
      }
    }

    throw error;
  }

  return {
    baseUrl,
    config: runtimeConfig,
    stop: async () => {
      await handle.shutdown();
      await proxyTarget?.stop();
      process.env.NODE_ENV = previousNodeEnv;
      process.env.HOST = previousHost;
      process.env.PORT = previousPort;
      process.env.BOS_MF_IDENTITY = previousIdentityMode;

      const proxyIdx = process.argv.indexOf("--proxy");
      if (proxyIdx !== -1) {
        process.argv.splice(proxyIdx, 1);
      }
    },
  };
}
