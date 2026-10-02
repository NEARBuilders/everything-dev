import type { ApiClient } from "@/app";

export const NODE_PLUGIN_ID = "api";

export function nodeProposalsQueryKey(nodeId: string) {
  return ["node-proposals", nodeId] as const;
}

export function nodeProposalsQueryOptions(apiClient: ApiClient, nodeId: string) {
  return {
    queryKey: nodeProposalsQueryKey(nodeId),
    queryFn: () =>
      apiClient.proposals.getProposals({
        pluginId: NODE_PLUGIN_ID,
        entityId: nodeId,
        limit: 100,
      }),
    enabled: !!nodeId,
    staleTime: 30 * 1000,
  };
}
