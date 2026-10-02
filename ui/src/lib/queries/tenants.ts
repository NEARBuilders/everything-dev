import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";

export const tenantQueryKeys = {
  all: ["tenants"] as const,
  lists: () => [...tenantQueryKeys.all, "list"] as const,
  list: () => [...tenantQueryKeys.lists(), "all"] as const,
  apps: () => [...tenantQueryKeys.lists(), "apps"] as const,
  stakeCommunities: (scope: string) =>
    [...tenantQueryKeys.lists(), "stake-communities", scope] as const,
  organizationIds: (organizationIds: readonly string[]) =>
    [...tenantQueryKeys.lists(), "organizations", organizationIds] as const,
  details: () => [...tenantQueryKeys.all, "detail"] as const,
  byKey: (tenantKey: string, gatewayId: string) =>
    [...tenantQueryKeys.details(), "key", tenantKey, gatewayId] as const,
  byOrg: (orgId: string) => [...tenantQueryKeys.details(), "org", orgId] as const,
  bindings: (tenantId: string) =>
    [...tenantQueryKeys.details(), "id", tenantId, "bindings"] as const,
  preflight: (hostname: string) => [...tenantQueryKeys.all, "binding-preflight", hostname] as const,
};

export function tenantsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: tenantQueryKeys.list(),
    queryFn: () => apiClient.listTenants(),
    staleTime: 30 * 1000,
  });
}

export function tenantByKeyQueryOptions(
  apiClient: ApiClient,
  tenantKey: string,
  gatewayId: string,
) {
  return queryOptions({
    queryKey: tenantQueryKeys.byKey(tenantKey, gatewayId),
    queryFn: async () => {
      const tenants = await apiClient.listTenants();
      const findById = (id: string) => tenants.find((tenant) => tenant.id === id) ?? null;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantKey)) {
        return findById(tenantKey);
      }
      if (tenantKey.includes(".")) {
        const resolved = await apiClient.resolveTenant({ accountId: tenantKey });
        return resolved ? findById(resolved.id) : null;
      }
      const binding = await apiClient
        .resolveBindingByHostname({ hostname: `${tenantKey}.${gatewayId}` })
        .catch(() => null);
      if (binding) return findById(binding.tenantId);
      const node = await apiClient.resolveNodeBySlug({ slug: tenantKey });
      return node?.tenantId ? findById(node.tenantId) : null;
    },
  });
}

export function tenantAppsQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: tenantQueryKeys.apps(),
    queryFn: () => apiClient.listTenantApps(),
    staleTime: 30 * 1000,
  });
}

export function stakeCommunitiesQueryOptions(apiClient: ApiClient, scope: string) {
  return queryOptions({
    queryKey: tenantQueryKeys.stakeCommunities(scope),
    queryFn: () => apiClient.listStakeCommunities(),
    staleTime: 30 * 1000,
  });
}

export function tenantOrganizationIdsQueryOptions(
  apiClient: ApiClient,
  organizationIds: readonly string[],
) {
  return queryOptions({
    queryKey: tenantQueryKeys.organizationIds(organizationIds),
    queryFn: async () => {
      const results = await Promise.allSettled(
        organizationIds.map((orgId) => apiClient.resolveTenantByOrgId({ orgId })),
      );
      return new Set(organizationIds.filter((_, index) => results[index]?.status === "fulfilled"));
    },
    staleTime: 60 * 1000,
  });
}

export function tenantByOrgQueryOptions(apiClient: ApiClient, orgId: string) {
  return queryOptions({
    queryKey: tenantQueryKeys.byOrg(orgId),
    queryFn: async () => {
      try {
        return await apiClient.resolveTenantByOrgId({ orgId });
      } catch {
        return null;
      }
    },
    enabled: !!orgId,
  });
}

export function tenantBindingsQueryOptions(apiClient: ApiClient, tenantId: string) {
  return queryOptions({
    queryKey: tenantQueryKeys.bindings(tenantId),
    queryFn: () => apiClient.listTenantBindingsForTenant({ tenantId }),
  });
}

export function bindingPreflightQueryOptions(apiClient: ApiClient, hostname: string) {
  return queryOptions({
    queryKey: tenantQueryKeys.preflight(hostname),
    queryFn: () => apiClient.bindingPreflight({ hostname }),
    staleTime: 5000,
  });
}

export function invalidateTenantQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: tenantQueryKeys.all });
}
