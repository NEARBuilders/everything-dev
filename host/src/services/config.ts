import { Config, Context, type Effect } from "effect";
import type {
  ClientRuntimeConfig,
  RuntimeConfig,
  SharedConfig,
  SourceMode,
} from "everything-dev/types";
import type { ComposePayload } from "everything-dev/ui/manifest";
import type { RuntimePlugin } from "../types";
import { normalizeUrl } from "../utils/normalize";

export type { ClientRuntimeConfig, RuntimeConfig, SharedConfig, SourceMode };

export class ConfigService extends Context.Service<ConfigService, RuntimeConfig>()(
  "host/ConfigService",
) {}

export function readCorsOrigins(): Effect.Effect<string[], Config.ConfigError> {
  return Config.String("CORS_ORIGIN").pipe(
    Config.withDefault(""),
    Config.map((value) =>
      value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
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

/**
 * Browser-facing base for a ui surface (ADR 0011): `publicUrl` declares the
 * base browsers must load a remote from — the image-native runtime serves
 * /bundles/<account>/<gateway>/<slot>/ same-origin while its server-side MF
 * loading stays on the container-local `url`. Absent (dev stacks, published
 * configs, tenant overrides) `url` is directly reachable and wins.
 */
const clientUiUrl = (ui: { url: string; publicUrl?: string | undefined }): string =>
  ui.publicUrl ?? ui.url;

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
  composePayload?: ComposePayload,
): RuntimeClientConfig {
  const requestUrl = new URL(request.url);
  const uiConfig = config.ui;

  if (!uiConfig) {
    throw new Error("UI config is required to build the runtime client config");
  }

  const coreUiUrl = clientUiUrl(uiConfig);

  return {
    env: config.env,
    account: activeRuntime.accountId,
    networkId: config.account.endsWith(".testnet") ? "testnet" : "mainnet",
    hostUrl: requestUrl.origin,
    assetsUrl: coreUiUrl,
    apiBase: "/api",
    rpcBase: "/api/rpc",
    authAvailable,
    repository: config.repository,
    ui: {
      name: uiConfig.name,
      url: coreUiUrl,
      entry: uiConfig.publicUrl
        ? `${uiConfig.publicUrl.replace(/\/$/, "")}/mf-manifest.json`
        : uiConfig.entry,
      integrity: uiConfig.integrity,
      compose: composePayload,
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
                    url: clientUiUrl(plugin.ui),
                    entry: plugin.ui.publicUrl
                      ? `${plugin.ui.publicUrl.replace(/\/$/, "")}/mf-manifest.json`
                      : plugin.ui.entry,
                    source: plugin.ui.source,
                    integrity: plugin.ui.integrity,
                    ssrUrl: plugin.ui.ssrUrl,
                    ssrIntegrity: plugin.ui.ssrIntegrity,
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
