import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient, RouterContract } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { useRouter } from "@tanstack/react-router";

export type { RouterContract };

/** typed client for the app's default router contract (router-context default) */
export type ApiClient<T extends RouterContract = RouterContract> = ContractRouterClient<T>;

export interface ClientServiceConfig {
  hostUrl: string;
  rpcBase: `/${string}`;
}

type ClientRouterContext = {
  apiClient?: unknown;
  pluginClients?: Record<string, unknown>;
};

export type { ClientRouterContext };

function createRpcLink(config: ClientServiceConfig, url: `/${string}`, headers?: Headers) {
  return new RPCLink({
    origin: config.hostUrl,
    url,
    interceptors: [
      onError((error: unknown) => {
        if (typeof window === "undefined") {
          return;
        }

        if (error && typeof error === "object" && "message" in error) {
          const message = String(error.message).toLowerCase();
          if (
            message.includes("fetch") ||
            message.includes("network") ||
            message.includes("failed to fetch")
          ) {
            void import("sonner")
              .then(({ toast }) => {
                toast.error("Unable to connect to API", {
                  id: "api-connection-error",
                  description: "The API is currently unavailable. Please try again later.",
                });
              })
              .catch(() => {});
          }
        }
      }),
    ],
    fetch(fetchUrl: RequestInfo | URL, options?: RequestInit) {
      return fetch(fetchUrl, {
        ...options,
        credentials: "include",
        headers: headers
          ? { ...Object.fromEntries(headers), ...(options?.headers as Record<string, string>) }
          : options?.headers,
      });
    },
  });
}

function buildClient<T extends RouterContract>(
  config: ClientServiceConfig,
  url: `/${string}`,
  headers?: Headers,
): ContractRouterClient<T> {
  if (!config.hostUrl) {
    throw new Error("Missing runtime host URL");
  }
  return createORPCClient(createRpcLink(config, url, headers)) as ContractRouterClient<T>;
}

const browserClients = new Map<string, unknown>();

function memoizedClient<T extends RouterContract>(
  config: ClientServiceConfig,
  url: `/${string}`,
  headers?: Headers,
): ContractRouterClient<T> {
  if (typeof window !== "undefined" && !headers) {
    const key = `${config.hostUrl}${url}`;
    const memoized = browserClients.get(key);
    if (memoized) {
      return memoized as ContractRouterClient<T>;
    }
    const client = buildClient<T>(config, url, headers);
    browserClients.set(key, client);
    return client;
  }

  return buildClient<T>(config, url, headers);
}

export function createApiClient<T extends RouterContract = RouterContract>(
  config: ClientServiceConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  return memoizedClient<T>(config, config.rpcBase, headers);
}

export function createPluginApiClient<T extends RouterContract = RouterContract>(
  pluginKey: string,
  config: ClientServiceConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  return memoizedClient<T>(config, `${config.rpcBase}/${pluginKey}`, headers);
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
