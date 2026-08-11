import { Config, ConfigProvider, Context, Effect } from "every-plugin/effect";
import type {
  ClientRuntimeConfig,
  RuntimeConfig,
  SharedConfig,
  SourceMode,
} from "everything-dev/types";
import type { RuntimePlugin } from "../types";
import { normalizeUrl } from "../utils/normalize";

export type { ClientRuntimeConfig, RuntimeConfig, SharedConfig, SourceMode };

export class ConfigService extends Context.Tag("host/ConfigService")<
  ConfigService,
  RuntimeConfig
>() {}

export function readCorsOrigins(): Effect.Effect<string[]> {
  return Config.array(Config.string(), "CORS_ORIGIN").pipe(
    Effect.map((arr) => arr.filter((s) => s.length > 0)),
    Effect.catchAll(() => Effect.succeed([] as string[])),
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
  );
}

export type ActiveRuntimeState = NonNullable<ClientRuntimeConfig["runtime"]>;

export type RuntimeClientConfig = ClientRuntimeConfig & { runtime?: ActiveRuntimeState };

function getFallbackGatewayId(config: RuntimeConfig) {
  if (config.domain) {
    return config.domain;
  }
  return normalizeUrl(config.host?.url)?.replace(/^https?:\/\//, "") ?? "runtime";
}

export function resolveActiveRuntime(config: RuntimeConfig, request: Request) {
  const url = new URL(request.url);
  const fallbackGatewayId = getFallbackGatewayId(config);
  return {
    accountId: config.account,
    gatewayId: fallbackGatewayId,
    runtimeBasePath: "/",
    title: config.title ?? config.account,
    description: config.description ?? null,
    hostUrl: url.origin,
  } satisfies ActiveRuntimeState;
}

export function buildRuntimeClientConfig(
  config: RuntimeConfig,
  request: Request,
  activeRuntime: ActiveRuntimeState,
  authAvailable: boolean,
): RuntimeClientConfig {
  const requestUrl = new URL(request.url);
  const uiConfig = config.ui;

  if (!uiConfig) {
    throw new Error("UI config is required to build the runtime client config");
  }

  return {
    env: config.env,
    account: activeRuntime.accountId,
    networkId: config.account.endsWith(".testnet") ? "testnet" : "mainnet",
    hostUrl: requestUrl.origin,
    assetsUrl: uiConfig.url,
    apiBase: "/api",
    rpcBase: "/api/rpc",
    authAvailable,
    repository: config.repository,
    ui: {
      name: uiConfig.name,
      url: uiConfig.url,
      entry: uiConfig.entry,
      integrity: uiConfig.integrity,
    },
    api: config.api
      ? {
          name: config.api.name,
          url: config.api.url,
          entry: config.api.entry,
          integrity: config.api.integrity,
          ...(config.api.variables ? { variables: config.api.variables } : {}),
        }
      : undefined,
    auth: config.auth
      ? {
          name: config.auth.name,
          url: config.auth.url,
          entry: config.auth.entry,
          integrity: config.auth.integrity,
          ...(config.auth.variables ? { variables: config.auth.variables } : {}),
        }
      : undefined,
    plugins: Object.fromEntries(
      (Object.entries(config.plugins ?? {}) as Array<[string, RuntimePlugin]>).map(
        ([key, plugin]) => [
          key,
          {
            name: plugin.name,
            url: plugin.url,
            entry: plugin.entry,
            integrity: plugin.integrity,
            ...(plugin.variables ? { variables: plugin.variables } : {}),
            ...(plugin.ui
              ? {
                  ui: {
                    name: plugin.ui.name,
                    url: plugin.ui.url,
                    entry: plugin.ui.entry,
                    source: plugin.ui.source,
                    integrity: plugin.ui.integrity,
                  },
                }
              : {}),
          },
        ],
      ),
    ),
    runtime: activeRuntime,
  } as RuntimeClientConfig;
}
