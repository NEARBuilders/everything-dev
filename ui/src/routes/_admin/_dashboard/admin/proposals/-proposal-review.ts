import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";
import { proposalReviewQueryKeys } from "@/lib/queries/proposals";
import { nodeProposalPayloadSchema } from "@/routes/_authenticated/_dashboard/-node-application";

export { proposalReviewQueryKeys } from "@/lib/queries/proposals";

export const PROPOSAL_REVIEW_FILTERS = ["pending", "approved", "rejected", "all"] as const;

export type ProposalReviewFilter = (typeof PROPOSAL_REVIEW_FILTERS)[number];

export const DEFAULT_PROPOSAL_REVIEW_FILTER: ProposalReviewFilter = "all";

export function parseProposalReviewFilter(value: unknown): ProposalReviewFilter | undefined {
  return typeof value === "string" &&
    PROPOSAL_REVIEW_FILTERS.includes(value as ProposalReviewFilter)
    ? (value as ProposalReviewFilter)
    : undefined;
}

export const PROPOSAL_REVIEW_FILTER_LABELS: Record<ProposalReviewFilter, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  all: "All",
};

export function proposalReviewStatusVariant(
  status: "pending" | "approved" | "rejected" | "removed",
) {
  if (status === "rejected") return "destructive" as const;
  if (status === "pending") return "warning" as const;
  if (status === "removed") return "outline" as const;
  return "success" as const;
}

interface ProposalIdentity {
  pluginId: string;
  entityId: string;
  payload: unknown;
}

export function proposalTitle({ pluginId, entityId, payload }: ProposalIdentity) {
  if (pluginId === "node") {
    const parsed = nodeProposalPayloadSchema.safeParse(payload);
    if (parsed.success) return parsed.data.name;
  }
  return entityId;
}

export function proposalTypeLabel(pluginId: string) {
  if (pluginId === "node") return "Community";
  if (pluginId === "template") return "Thing";
  return pluginId.charAt(0).toUpperCase() + pluginId.slice(1);
}

export function pendingProposalCountQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: proposalReviewQueryKeys.pendingCount(),
    queryFn: () => apiClient.proposals.getProposals({ reviewStatus: "pending" as const, limit: 1 }),
    staleTime: 15 * 1000,
  });
}

export function adminProposalListQueryOptions(apiClient: ApiClient, filter: ProposalReviewFilter) {
  return infiniteQueryOptions({
    queryKey: proposalReviewQueryKeys.list(filter),
    queryFn: ({ pageParam }) =>
      apiClient.proposals.getProposals({
        ...(filter !== "all" && { reviewStatus: filter }),
        limit: 50,
        ...(pageParam !== undefined && { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    staleTime: 15 * 1000,
  });
}

export function adminProposalDetailQueryOptions(
  apiClient: ApiClient,
  proposalId: string,
  pluginId?: string,
  entityId?: string,
) {
  return queryOptions({
    queryKey: proposalReviewQueryKeys.detail(proposalId, pluginId, entityId),
    queryFn: async () => {
      if (!pluginId || !entityId) throw new Error("Proposal location is missing");
      const result = await apiClient.proposals.getProposals({ pluginId, entityId, limit: 1 });
      return result.data.find((proposal) => proposal.id === proposalId) ?? null;
    },
    enabled: !!pluginId && !!entityId,
  });
}

export function proposalReviewHistoryQueryOptions(apiClient: ApiClient, pluginId?: string) {
  return queryOptions({
    queryKey: proposalReviewQueryKeys.history(pluginId),
    queryFn: () => {
      if (!pluginId) throw new Error("Plugin ID is missing");
      return apiClient.proposals.getReviewHistory({ pluginId, limit: 100 });
    },
    enabled: !!pluginId,
    staleTime: 15 * 1000,
  });
}
