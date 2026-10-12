import type { ContractRouterClient, RouterContract } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { useRouter } from "@tanstack/react-router";
import { createRpcClient, type RpcConnectionErrorCopy } from "every-plugin";

export type { RouterContract };

/**
 * Localized copy for the API connection-failure toast — the app's authored
 * override seam (ADR 0023). Called at error time, so the implementation may
 * resolve the active locale itself.
 */
export type ApiConnectionErrorCopy = RpcConnectionErrorCopy;

/** typed client for the app's default router contract (router-context default) */
export type ApiClient<T extends RouterContract = RouterContract> = ContractRouterClient<T>;

export interface ClientServiceConfig {
  hostUrl: string;
  rpcBase: `/${string}`;
  connectionError?: ApiConnectionErrorCopy;
}

type ClientRouterContext = {
  apiClient?: unknown;
  pluginClients?: Record<string, unknown>;
};

export type { ClientRouterContext };

export function createApiClient<T extends RouterContract = RouterContract>(
  config: ClientServiceConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  return createRpcClient<T>(
    {
      hostUrl: config.hostUrl,
      path: config.rpcBase,
      connectionError: config.connectionError,
    },
    headers,
  );
}

export function createPluginApiClient<T extends RouterContract = RouterContract>(
  pluginKey: string,
  config: ClientServiceConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  return createRpcClient<T>(
    {
      hostUrl: config.hostUrl,
      path: `${config.rpcBase}/${pluginKey}`,
      connectionError: config.connectionError,
    },
    headers,
  );
}

export function createServiceClients<
  C extends Record<string, RouterContract>,
  K extends keyof C & string = keyof C & string,
>(
  config: ClientServiceConfig,
  keys: readonly K[],
  headers?: Headers,
): Pick<{ [P in keyof C]: ContractRouterClient<C[P]> }, K> {
  const clients: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "api") {
      clients[key] = createApiClient<C[typeof key]>(config, headers);
    } else {
      clients[key] = createPluginApiClient<C[typeof key]>(key, config, headers);
    }
  }
  return clients as Pick<{ [P in keyof C]: ContractRouterClient<C[P]> }, K>;
}

function useClientContext(): ClientRouterContext {
  return useRouter().options.context as ClientRouterContext;
}

export function useApiClient<T extends RouterContract = RouterContract>(): ContractRouterClient<T> {
  return useClientContext().apiClient as ContractRouterClient<T>;
}

export function useOrpc<T extends RouterContract = RouterContract>() {
  return createTanstackQueryUtils(useApiClient<T>());
}

export function usePluginClients<C extends Record<string, unknown> = Record<string, unknown>>(): C {
  return (useClientContext().pluginClients ?? {}) as C;
}
