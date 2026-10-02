import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@/app";
import { rootNodesQueryOptions } from "@/lib/queries/nodes";

interface TenantWizardLoaderContext {
  activeOrganizationId: string | null;
  apiClient: ApiClient;
  queryClient: QueryClient;
}

export async function loadTenantWizardParents({
  activeOrganizationId,
  apiClient,
  queryClient,
}: TenantWizardLoaderContext) {
  if (!activeOrganizationId) return [];
  return await queryClient.ensureQueryData(rootNodesQueryOptions(apiClient));
}
