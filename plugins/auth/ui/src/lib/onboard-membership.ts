import type { QueryClient } from "@tanstack/react-query";
import { type AuthClient, refreshSessionCache } from "everything-dev/ui/auth";
import type { AuthApiClient } from "./api";

export const organizationsQueryKey = ["organizations"] as const;

export async function verifyOrganizationMembership({
  apiClient,
  auth,
  queryClient,
  organizationId,
}: {
  apiClient: Pick<AuthApiClient, "listOrganizations" | "setActiveOrganization">;
  auth: AuthClient;
  queryClient: QueryClient;
  organizationId?: string;
}): Promise<boolean> {
  const [organizations, session] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: organizationsQueryKey,
      queryFn: () => apiClient.listOrganizations(),
      staleTime: 0,
    }),
    refreshSessionCache(auth, queryClient),
  ]);
  const memberOf = new Set(organizations.map((organization) => organization.id));

  const activeOrganizationId = session?.session.activeOrganizationId;
  if (activeOrganizationId && !memberOf.has(activeOrganizationId)) {
    await apiClient.setActiveOrganization({ organizationId: null });
    await refreshSessionCache(auth, queryClient);
  }

  return !!organizationId && memberOf.has(organizationId);
}
