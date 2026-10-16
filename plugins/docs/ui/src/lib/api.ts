/**
 * The docs ui's api-client seam — mirrors the core ui's lib/api.ts: the docs
 * contract (its own server source, workspace-local whenever this ui is
 * local) binds once here, so routes import the typed client from @/lib/api
 * instead of walking into server sources. The contract import stays
 * type-only — binding is a pure type instantiation, and a value import
 * would drag the server contract's schemas into the browser bundle.
 */

import type { ContractRouterClient } from "@orpc/contract";
import type { ClientServiceConfig } from "everything-dev/ui/api";
import { createPluginApiClient } from "everything-dev/ui/api";
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
