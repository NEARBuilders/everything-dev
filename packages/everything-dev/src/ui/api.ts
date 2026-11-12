import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient, RouterContract } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { useRouter } from "@tanstack/react-router";

export type { RouterContract };

/**
 * Localized copy for the API connection-failure toast — the app's authored
 * override seam (ADR 0023). Called at error time, so the implementation may
 * resolve the active locale itself.
 */
export type ApiConnectionErrorCopy = () => { title: string; description: string };

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

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_RETRY_CAP_MS = 2_000;

const browserClients = new Map<string, ContractRouterClient<RouterContract>>();

type FetchInput = Parameters<typeof fetch>[0];

async function fetchWithBrowserDefaults(
  fetchUrl: FetchInput,
  headers: Headers | undefined,
  options?: RequestInit,
): Promise<Response> {
  const init: RequestInit = {
    ...options,
    credentials: "include",
    headers: mergeHeaders(headers, options?.headers),
  };
  let response = await fetch(fetchUrl, init);
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES && response.status === 429; attempt++) {
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, RATE_LIMIT_RETRY_CAP_MS)
        : 100 * attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await fetch(fetchUrl, init);
  }
  return response;
}

function mergeHeaders(base: Headers | undefined, overrides?: RequestInit["headers"]): Headers {
  const merged = new Headers(base);
  new Headers(overrides).forEach((value, key) => {
    merged.set(key, value);
  });
  return merged;
}

function buildBrowserClient<T extends RouterContract>(
  hostUrl: string,
  path: `/${string}`,
  headers: Headers | undefined,
  connectionError: ApiConnectionErrorCopy | undefined,
): ContractRouterClient<T> {
  return createORPCClient(
    new RPCLink({
      origin: hostUrl,
      url: path,
      interceptors: [
        onError((error: unknown) => {
          if (typeof window === "undefined") return;
          if (!(error && typeof error === "object" && "message" in error)) return;
          const message = String(error.message).toLowerCase();
          if (
            !message.includes("fetch") &&
            !message.includes("network") &&
            !message.includes("failed to fetch")
          ) {
            return;
          }
          void import("sonner")
            .then(({ toast }) => {
              const copy = connectionError?.() ?? {
                title: "Unable to connect to API",
                description: "The API is currently unavailable. Please try again later.",
              };
              toast.error(copy.title, {
                id: "api-connection-error",
                description: copy.description,
              });
            })
            .catch(() => {});
        }),
      ],
      fetch(fetchUrl: FetchInput, options?: RequestInit) {
        return fetchWithBrowserDefaults(fetchUrl, headers, options);
      },
    }),
  ) as ContractRouterClient<T>;
}

function clientFor<T extends RouterContract>(
  hostUrl: string,
  path: `/${string}`,
  headers: Headers | undefined,
  connectionError: ApiConnectionErrorCopy | undefined,
): ContractRouterClient<T> {
  if (typeof window !== "undefined" && !headers) {
    const key = `${hostUrl}${path}`;
    const memoized = browserClients.get(key);
    if (memoized) return memoized as ContractRouterClient<T>;
    const client = buildBrowserClient<T>(hostUrl, path, headers, connectionError);
    browserClients.set(key, client as ContractRouterClient<RouterContract>);
    return client;
  }
  return buildBrowserClient<T>(hostUrl, path, headers, connectionError);
}

export function createApiClient<T extends RouterContract = RouterContract>(
  config: ClientServiceConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  return clientFor<T>(config.hostUrl, config.rpcBase, headers, config.connectionError);
}

export function createPluginApiClient<T extends RouterContract = RouterContract>(
  pluginKey: string,
  config: ClientServiceConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  return clientFor<T>(
    config.hostUrl,
    `${config.rpcBase}/${pluginKey}`,
    headers,
    config.connectionError,
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
