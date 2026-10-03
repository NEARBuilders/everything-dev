import type { QueryClient } from "@tanstack/react-query";
import { invalidateProposalQueries } from "@/lib/queries/proposals";

export const thingQueryKeys = {
  list: ["things-list"] as const,
  detail: (thingId: string) => ["thing", thingId] as const,
  proposal: (thingId: string) => ["thing-proposal", thingId] as const,
  upvoteCount: (thingId: string) => ["thing-upvote-count", thingId] as const,
  userVote: (thingId: string) => ["thing-user-vote", thingId] as const,
  upvoteCounts: ["thing-upvote-counts"] as const,
};

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
