import { type QueryClient, queryOptions } from "@tanstack/react-query";
import type { ApiClient } from "@/app";

const NODE_STALE_TIME = 30 * 1000;

export type AdminNodeListScope = "roots" | "all";

type NodeRecord = Awaited<ReturnType<ApiClient["listNodes"]>>[number];
export type AdminNodeListKind = NonNullable<NodeRecord["kind"]> | "all";

export interface AdminNodeListRow {
  node: NodeRecord;
  parent: NodeRecord | undefined;
  status: string;
  childrenCount: number;
  validatorCount: number;
}

export const nodeQueryKeys = {
  all: ["nodes"] as const,
  lists: () => [...nodeQueryKeys.all, "list"] as const,
  allNodes: () => [...nodeQueryKeys.lists(), "all"] as const,
  roots: () => [...nodeQueryKeys.lists(), "roots"] as const,
  children: (parentId: string) => [...nodeQueryKeys.lists(), "children", parentId] as const,
  tenant: (tenantId: string) => [...nodeQueryKeys.lists(), "tenant", tenantId] as const,
  adminList: (scope: AdminNodeListScope, kind: AdminNodeListKind) =>
    [...nodeQueryKeys.lists(), "admin", scope, kind] as const,
  details: () => [...nodeQueryKeys.all, "detail"] as const,
  byId: (nodeId: string) => [...nodeQueryKeys.details(), "id", nodeId] as const,
  bySlug: (slug: string, parentId?: string | null) =>
    [
      ...nodeQueryKeys.details(),
      "slug",
      slug,
      parentId === undefined ? "any" : (parentId ?? "root"),
    ] as const,
  adminDetail: (nodeId: string) => [...nodeQueryKeys.details(), "admin", nodeId] as const,
  validators: (nodeId: string) => [...nodeQueryKeys.details(), nodeId, "validators"] as const,
  stakingValidators: (nodeId: string) =>
    [...nodeQueryKeys.details(), nodeId, "staking-validators"] as const,
};

export function allNodesQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: nodeQueryKeys.allNodes(),
    queryFn: () => apiClient.listNodes({}),
    staleTime: NODE_STALE_TIME,
  });
}

export function rootNodesQueryOptions(apiClient: ApiClient) {
  return queryOptions({
    queryKey: nodeQueryKeys.roots(),
    queryFn: () => apiClient.listRootNodes(),
    staleTime: NODE_STALE_TIME,
  });
}

export function childNodesQueryOptions(apiClient: ApiClient, parentId: string) {
  return queryOptions({
    queryKey: nodeQueryKeys.children(parentId),
    queryFn: () => apiClient.listChildren({ nodeId: parentId }),
    staleTime: NODE_STALE_TIME,
  });
}

export function tenantNodesQueryOptions(apiClient: ApiClient, tenantId: string) {
  return queryOptions({
    queryKey: nodeQueryKeys.tenant(tenantId),
    queryFn: () => apiClient.listNodes({ tenantId }),
  });
}

export function nodeByIdQueryOptions(apiClient: ApiClient, nodeId: string) {
  return queryOptions({
    queryKey: nodeQueryKeys.byId(nodeId),
    queryFn: () => apiClient.getNode({ nodeId }),
    staleTime: NODE_STALE_TIME,
  });
}

export function nodeBySlugQueryOptions(
  apiClient: ApiClient,
  slug: string,
  parentId?: string | null,
) {
  return queryOptions({
    queryKey: nodeQueryKeys.bySlug(slug, parentId),
    queryFn: () =>
      parentId === undefined
        ? apiClient.resolveNodeBySlug({ slug })
        : apiClient.resolveNodeBySlug({ slug, parentId }),
    staleTime: NODE_STALE_TIME,
  });
}

export function nodeValidatorsQueryOptions(apiClient: ApiClient, nodeId: string) {
  return queryOptions({
    queryKey: nodeQueryKeys.validators(nodeId),
    queryFn: () => apiClient.listValidatorsByNode({ nodeId }),
  });
}

export function stakingValidatorsQueryOptions(apiClient: ApiClient, nodeId: string) {
  return queryOptions({
    queryKey: nodeQueryKeys.stakingValidators(nodeId),
    queryFn: () => apiClient.resolveStakingValidators({ nodeId }),
    staleTime: NODE_STALE_TIME,
  });
}

export function adminNodeListQueryOptions(
  apiClient: ApiClient,
  scope: AdminNodeListScope,
  kind: AdminNodeListKind,
) {
  return queryOptions({
    queryKey: nodeQueryKeys.adminList(scope, kind),
    queryFn: async () => {
      const [allNodes, tenants, summaries] = await Promise.all([
        apiClient.listNodes({}),
        apiClient.listTenants(),
        apiClient.listNodeSummaries({
          scope,
          ...(kind !== "all" && { kind }),
        }),
      ]);
      const parents = new Map(allNodes.map((node) => [node.id, node]));
      const statuses = new Map(tenants.map((tenant) => [tenant.id, tenant.status]));
      return summaries
        .map(
          ({ node, childrenCount, validatorCount }): AdminNodeListRow => ({
            node,
            parent: node.parentId ? parents.get(node.parentId) : undefined,
            status: (node.tenantId ? statuses.get(node.tenantId) : "standalone") ?? "unknown",
            childrenCount,
            validatorCount,
          }),
        )
        .sort((a, b) => a.node.name.localeCompare(b.node.name));
    },
    staleTime: NODE_STALE_TIME,
  });
}

export function adminNodeDetailQueryOptions(apiClient: ApiClient, nodeId: string) {
  return queryOptions({
    queryKey: nodeQueryKeys.adminDetail(nodeId),
    queryFn: async () => {
      const summary = await apiClient.getNodeSummary({ nodeId });
      const sourceNode =
        summary.stakingValidators.sourceNodeId === nodeId
          ? summary.node
          : await apiClient.getNode({ nodeId: summary.stakingValidators.sourceNodeId });
      const parent = summary.node.parentId
        ? await apiClient.getNode({ nodeId: summary.node.parentId })
        : null;
      return { summary, sourceNode, parent };
    },
    staleTime: NODE_STALE_TIME,
  });
}

export function invalidateNodeQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: nodeQueryKeys.all });
}
