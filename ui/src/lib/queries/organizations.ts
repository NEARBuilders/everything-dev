import { queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";

export type Organization = Awaited<ReturnType<ApiClient["auth"]["listOrganizations"]>>[number];

const ORGANIZATION_STALE_TIME = 30 * 1000;

export const organizationQueryKeys = {
  all: ["organizations"] as const,
  byId: (organizationId: string) =>
    [...organizationQueryKeys.all, "detail", organizationId] as const,
};

export function organizationByIdQueryOptions(apiClient: ApiClient, organizationId: string) {
  return queryOptions({
    queryKey: organizationQueryKeys.byId(organizationId),
    queryFn: () => apiClient.auth.getOrganizationForAdmin({ organizationId }),
    staleTime: ORGANIZATION_STALE_TIME,
  });
}

export function organizationsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: organizationQueryKeys.all,
    queryFn: () => apiClient.auth.listOrganizations(),
    staleTime: ORGANIZATION_STALE_TIME,
  });
}
