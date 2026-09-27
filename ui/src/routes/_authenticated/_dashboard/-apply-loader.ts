import type { QueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@/app";
import { rootNodesQueryOptions } from "@/lib/queries/nodes";

export function loadNodeApplicationParents({
  apiClient,
  queryClient,
}: {
  apiClient: ApiClient;
  queryClient: QueryClient;
}) {
  return queryClient.ensureQueryData(rootNodesQueryOptions(apiClient));
}
