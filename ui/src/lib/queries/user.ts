import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";

const PASSKEYS_STALE_TIME = 60 * 1000;
const INVITATIONS_STALE_TIME = 30 * 1000;

export function userPasskeysQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: ["passkeys"],
    queryFn: () => apiClient.auth.listUserPasskeys(),
    staleTime: PASSKEYS_STALE_TIME,
  });
}

export function userInvitationsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: ["user-invitations"],
    queryFn: async () => {
      try {
        return await apiClient.auth.listUserInvitations();
      } catch {
        return [];
      }
    },
    staleTime: INVITATIONS_STALE_TIME,
  });
}
