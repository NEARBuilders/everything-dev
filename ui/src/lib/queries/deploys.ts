import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";

const DEPLOYS_STALE_TIME = 30 * 1000;

export const deployQueryKeys = {
  all: ["deploys"] as const,
  byNamespace: (account: string, gateway: string) => ["deploys", account, gateway] as const,
};

export function deploysQueryOptions(apiClient: ApiClient, account: string, gateway: string) {
  return queryOptions({
    queryKey: deployQueryKeys.byNamespace(account, gateway),
    queryFn: () => apiClient.hosting.listDeploys({ account, gateway, limit: 50 }),
    staleTime: DEPLOYS_STALE_TIME,
  });
}
