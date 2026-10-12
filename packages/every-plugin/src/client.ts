import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient, RouterContract } from "@orpc/contract";

export type RpcConnectionErrorCopy = () => { title: string; description: string };

export interface RpcClientConfig {
  hostUrl: string;
  path: `/${string}`;
  connectionError?: RpcConnectionErrorCopy;
}

const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_RETRY_CAP_MS = 2_000;
const browserClients = new Map<string, unknown>();

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

function createRpcLink(config: RpcClientConfig, headers?: Headers) {
  return new RPCLink({
    origin: config.hostUrl,
    url: config.path,
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

function buildRpcClient<T extends RouterContract>(
  config: RpcClientConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  if (!config.hostUrl) {
    throw new Error("Missing runtime host URL");
  }

  return createORPCClient(createRpcLink(config, headers)) as ContractRouterClient<T>;
}

export function createRpcClient<T extends RouterContract = RouterContract>(
  config: RpcClientConfig,
  headers?: Headers,
): ContractRouterClient<T> {
  if (typeof window !== "undefined" && !headers) {
    const key = `${config.hostUrl}${config.path}`;
    const memoized = browserClients.get(key);
    if (memoized) {
      return memoized as ContractRouterClient<T>;
    }

    const client = buildRpcClient<T>(config, headers);
    browserClients.set(key, client);
    return client;
  }

  return buildRpcClient<T>(config, headers);
}
