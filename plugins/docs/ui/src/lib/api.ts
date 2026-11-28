/**
 * The docs ui's api-client seam. Routes prefer the shared api client from
 * the router context — the core contract namespaces the docs plugin, and on
 * SSR the host provides the in-process client through the same property —
 * so reads ride exactly the seam every core route uses. The local fallback
 * keeps the plugin ui usable standalone (dev overlay preview), where no
 * host context exists.
 */

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
  // Standalone fallback (the dev overlay's own preview): the every-plugin
  // dev server serves the plugin's procedures un-namespaced under
  // /api/rpc — the base oRPC client, not the host-composed namespaced one.
  return createApiClient<typeof contract>(resolveClientConfig(context.runtimeConfig));
}
