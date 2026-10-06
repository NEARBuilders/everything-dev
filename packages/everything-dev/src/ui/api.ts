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
  connectionError?: () => { title: string; description: string };
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
                const message = config.connectionError?.() ?? {
                  title: "Unable to connect to API",
                  description: "The API is currently unavailable. Please try again later.",
                };
                toast.error(message.title, {
                  id: "api-connection-error",
                  description: message.description,
                });
              })
              .catch(() => {});
          }
        }
      }),
    ],
    fetch(fetchUrl: RequestInfo | URL, options?: RequestInit) {
      return fetchWithRateLimitRetry(fetchUrl, {
        ...options,
        credentials: "include",
        headers: headers
          ? { ...Object.fromEntries(headers), ...(options?.headers as Record<string, string>) }
          : options?.headers,
      });
    },
  });
}

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_RETRY_CAP_MS = 2_000;

/**
 * A 429 from the host's edge limiter is transient saturation, not an
 * application failure — retry within the server's `Retry-After` (capped) so
 * queries and the session check self-heal instead of surfacing errors.
 */
async function fetchWithRateLimitRetry(
  fetchUrl: RequestInfo | URL,
  options?: RequestInit,
): Promise<Response> {
  let response = await fetch(fetchUrl, options);
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES && response.status === 429; attempt++) {
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, RATE_LIMIT_RETRY_CAP_MS)
        : 100 * attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await fetch(fetchUrl, options);
  }
  return response;
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
