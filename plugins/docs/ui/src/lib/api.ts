import type { ContractRouterClient } from "@orpc/contract";
import type { ClientServiceConfig } from "everything-dev/ui/api";
import { createApiClient, createPluginApiClient } from "everything-dev/ui/api";
import type { contract } from "../../../src/contract";

export type DocsApiClient = ContractRouterClient<typeof contract>;

export function createDocsApiClient(config: ClientServiceConfig): DocsApiClient {
  return createPluginApiClient<typeof contract>("docs", config);
}

export function resolveClientConfig(runtimeConfig?: { hostUrl?: string; rpcBase?: string }): {
  hostUrl: string;
  rpcBase: "/api/rpc";
} {
  return {
    hostUrl:
      runtimeConfig?.hostUrl ?? (typeof window !== "undefined" ? window.location.origin : ""),
    rpcBase: (runtimeConfig?.rpcBase ?? "/api/rpc") as "/api/rpc",
  };
}

type DocsClientContext = {
  apiClient?: unknown;
  runtimeConfig?: { hostUrl?: string; rpcBase?: string };
};

export function resolveDocsClient(context: DocsClientContext): DocsApiClient {
  const shared = (context.apiClient as { docs?: DocsApiClient } | undefined)?.docs;
  if (shared) return shared;
  return createApiClient<typeof contract>(resolveClientConfig(context.runtimeConfig));
}
