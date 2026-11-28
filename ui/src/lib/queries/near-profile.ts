import { queryOptions } from "@tanstack/react-query";
import type { AuthClient } from "@/app";

const NEAR_PROFILE_STALE_TIME = 5 * 60 * 1000;

export const nearProfileQueryKeys = {
  all: ["near-profile"] as const,
  byAccount: (accountId: string) => ["near-profile", accountId] as const,
};

export function nearProfileQueryOptions(authClient: AuthClient, accountId: string) {
  return queryOptions({
    queryKey: nearProfileQueryKeys.byAccount(accountId),
    queryFn: async () => {
      const { data } = await authClient.near.getProfile(accountId);
      return data ?? null;
    },
    staleTime: NEAR_PROFILE_STALE_TIME,
  });
}
