import type { QueryClient } from "@tanstack/react-query";

export const proposalReviewQueryKeys = {
  all: ["admin-proposals"] as const,
  lists: () => [...proposalReviewQueryKeys.all, "list"] as const,
  list: (filter: "pending" | "approved" | "rejected" | "all") =>
    [...proposalReviewQueryKeys.lists(), filter] as const,
  pendingCount: () => [...proposalReviewQueryKeys.all, "pending-count"] as const,
  details: () => [...proposalReviewQueryKeys.all, "detail"] as const,
  detail: (proposalId: string, pluginId?: string, entityId?: string) =>
    [...proposalReviewQueryKeys.details(), proposalId, pluginId, entityId] as const,
  histories: () => [...proposalReviewQueryKeys.all, "review-history"] as const,
  history: (pluginId?: string) => [...proposalReviewQueryKeys.histories(), pluginId] as const,
};

export function invalidateProposalQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: proposalReviewQueryKeys.all });
}
