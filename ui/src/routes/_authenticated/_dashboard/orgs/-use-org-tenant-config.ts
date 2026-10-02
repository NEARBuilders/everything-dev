import { useQuery } from "@tanstack/react-query";
import { type ApiClient, useApiClient } from "@/app";
import { tenantBindingsQueryOptions, tenantByOrgQueryOptions } from "@/lib/queries/tenants";
import { resolvePrimaryHostname } from "../../../_admin/_dashboard/admin/tenants/-tenant-wizard";

export const TENANT_CONFIG_REFETCH_MS = 15_000;

export type OrgTenant = NonNullable<Awaited<ReturnType<ApiClient["resolveTenantByOrgId"]>>>;

type RegistryAppResult = Awaited<ReturnType<ApiClient["registry"]["getRegistryApp"]>>["data"];

export interface OrgTenantConfig {
  tenant: OrgTenant | null | undefined;
  daoOwned: boolean;
  tenantAccount: string;
  hostname: string | null;
  registryQuery: ReturnType<typeof useRegistryAppQuery>;
  resolvedConfig: NonNullable<RegistryAppResult>["resolvedConfig"] | null;
  configPublished: boolean;
  fetchPublishedNow: () => Promise<RegistryAppResult | null>;
}

function useRegistryAppQuery(
  apiClient: ApiClient,
  tenant: OrgTenant | null | undefined,
  tenantAccount: string,
  gatewayId: string,
) {
  return useQuery({
    queryKey: ["node-config", "registry-app", tenantAccount, gatewayId],
    queryFn: async () => {
      try {
        const result = await apiClient.registry.getRegistryApp({
          accountId: tenantAccount,
          gatewayId,
        });
        return result.data ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!tenant && !!gatewayId,
    refetchInterval: TENANT_CONFIG_REFETCH_MS,
  });
}

export function useOrgTenantConfig(orgId: string, gatewayId: string): OrgTenantConfig {
  const apiClient = useApiClient();

  const { data: tenant } = useQuery(tenantByOrgQueryOptions(apiClient, orgId));

  const daoOwned = tenant?.ownerKind === "dao";
  const tenantAccount = tenant?.accountId ?? "";

  const { data: bindings } = useQuery({
    ...tenantBindingsQueryOptions(apiClient, tenant?.id ?? ""),
    enabled: !!tenant,
  });
  const hostname = resolvePrimaryHostname(bindings);

  const registryQuery = useRegistryAppQuery(apiClient, tenant, tenantAccount, gatewayId);
  const registryApp = registryQuery.data;
  const resolvedConfig = registryApp?.resolvedConfig ?? null;
  const configPublished = !!registryApp;

  const fetchPublishedNow = () =>
    apiClient.registry
      .getRegistryApp({ accountId: tenantAccount, gatewayId })
      .then((result) => result.data ?? null)
      .catch(() => null);

  return {
    tenant,
    daoOwned,
    tenantAccount,
    hostname,
    registryQuery,
    resolvedConfig,
    configPublished,
    fetchPublishedNow,
  };
}
