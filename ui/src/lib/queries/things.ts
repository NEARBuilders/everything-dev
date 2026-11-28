import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";
import { invalidateProposalQueries } from "@/lib/queries/proposals";

export type Thing = Awaited<ReturnType<ApiClient["template"]["listThings"]>>["data"][number];

const THING_STALE_TIME = 30 * 1000;
const VOTE_STALE_TIME = 15 * 1000;

export const thingQueryKeys = {
  list: ["things-list"] as const,
  detail: (thingId: string) => ["thing", thingId] as const,
  proposal: (thingId: string) => ["thing-proposal", thingId] as const,
  upvoteCount: (thingId: string) => ["thing-upvote-count", thingId] as const,
  userVote: (thingId: string) => ["thing-user-vote", thingId] as const,
  upvoteCounts: ["thing-upvote-counts"] as const,
};

export function thingsListQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: thingQueryKeys.list,
    queryFn: () => apiClient.template.listThings({ limit: 50 }),
    staleTime: THING_STALE_TIME,
  });
}

export function thingProposalQueryOptions(apiClient: ApiClient, thingId: string) {
  return queryOptions({
    queryKey: thingQueryKeys.proposal(thingId),
    queryFn: async () => {
      const result = await apiClient.proposals.getProposals({
        pluginId: "template",
        entityId: thingId,
        limit: 1,
      });
      return result.data[0] ?? null;
    },
    refetchInterval: (query) => {
      const proposal = query.state.data;
      return proposal?.reviewStatus === "approved" && proposal.applyStatus === "applying"
        ? 2_000
        : false;
    },
  });
}

export function thingDetailQueryOptions(apiClient: ApiClient, thingId: string, enabled: boolean) {
  return queryOptions({
    queryKey: thingQueryKeys.detail(thingId),
    queryFn: () => apiClient.template.getThing({ thingId }),
    enabled,
    retry: false,
  });
}

export function upvoteCountQueryOptions(apiClient: ApiClient, thingId: string, enabled: boolean) {
  return queryOptions({
    queryKey: thingQueryKeys.upvoteCount(thingId),
    queryFn: () => apiClient.votes.getUpvoteCount({ entityId: thingId }),
    enabled,
    staleTime: VOTE_STALE_TIME,
  });
}

export function userVoteQueryOptions(apiClient: ApiClient, thingId: string, enabled: boolean) {
  return queryOptions({
    queryKey: thingQueryKeys.userVote(thingId),
    queryFn: () => apiClient.votes.getUserVote({ entityId: thingId }),
    enabled,
    staleTime: VOTE_STALE_TIME,
  });
}

export function upvoteCountsQueryOptions(apiClient: ApiClient, thingIds: string[]) {
  return queryOptions({
    queryKey: [...thingQueryKeys.upvoteCounts, thingIds],
    queryFn: () => apiClient.votes.getUpvoteCounts({ entityIds: thingIds }),
    enabled: thingIds.length > 0,
    staleTime: THING_STALE_TIME,
  });
}

export function invalidateThingAfterDelete(queryClient: QueryClient, thingId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.list, exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.detail(thingId), exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.proposal(thingId), exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.upvoteCount(thingId), exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.userVote(thingId), exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.upvoteCounts, exact: true }),
  ]);
}

export function invalidateThingAfterProposal(queryClient: QueryClient, thingId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.detail(thingId), exact: true }),
    queryClient.invalidateQueries({ queryKey: thingQueryKeys.proposal(thingId), exact: true }),
    invalidateProposalQueries(queryClient),
  ]);
}
