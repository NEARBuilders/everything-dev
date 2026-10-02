import { NetworkIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Button, EmptyState, PageContainer } from "@/components";
import { pageTitle } from "@/lib/page-title";
import { nodeQueryKeys } from "@/lib/queries/nodes";
import { CommunityHeader, communityAuthContextQueryOptions } from "./node/-community-header";
import { hasNodeProposalReviewPermission } from "./node/-node-access";
import { getNodeEmptyStateContent } from "./node/-node-empty-state";

type NodeDashboardSearch = { nodeId?: string };

export const Route = createFileRoute("/_authenticated/_dashboard/dashboard/node")({
  validateSearch: (search: Record<string, unknown>): NodeDashboardSearch => ({
    nodeId: typeof search.nodeId === "string" ? search.nodeId : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const activeOrganizationId = context.auth.activeOrganizationId;
    if (!activeOrganizationId) {
      return {
        tenant: null,
        nodes: [],
        selectedNode: null,
        summary: null,
        stakingSourceNode: null,
        canReview: false,
        canManage: false,
        emptyReason: "no-org" as const,
      };
    }

    const tenant = await context.apiClient
      .resolveTenantByOrgId({ orgId: activeOrganizationId })
      .catch(() => null);
    if (!tenant) {
      return {
        tenant: null,
        nodes: [],
        selectedNode: null,
        summary: null,
        stakingSourceNode: null,
        canReview: false,
        canManage: false,
        emptyReason: "no-tenant" as const,
      };
    }

    const nodes = (await context.apiClient.listNodes({ tenantId: tenant.id })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const selectedNode = nodes.find((node) => node.id === search.nodeId) ?? nodes[0] ?? null;
    if (!selectedNode) {
      return {
        tenant,
        nodes,
        selectedNode: null,
        summary: null,
        stakingSourceNode: null,
        canReview: false,
        canManage: false,
        emptyReason: "no-node" as const,
      };
    }

    const summary = await context.apiClient.getNodeSummary({ nodeId: selectedNode.id });
    const stakingSourceNode =
      summary.stakingValidators.sourceNodeId === selectedNode.id
        ? selectedNode
        : await context.apiClient.getNode({
            nodeId: summary.stakingValidators.sourceNodeId,
          });

    const canReview = hasNodeProposalReviewPermission(context.auth.user?.role);
    const authContext = await context.queryClient
      .ensureQueryData(communityAuthContextQueryOptions(context.apiClient, activeOrganizationId))
      .catch(() => null);
    context.queryClient.setQueryData(nodeQueryKeys.tenant(tenant.id), nodes);
    context.queryClient.setQueryData(nodeQueryKeys.byId(selectedNode.id), selectedNode);
    const orgRole = authContext?.organization?.member?.role;
    const canManage = canReview || orgRole === "owner" || orgRole === "admin";

    return {
      tenant,
      nodes,
      selectedNode,
      summary,
      stakingSourceNode,
      canReview,
      canManage,
      emptyReason: null,
    };
  },
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("My community", match.context.runtimeConfig) },
      { name: "description", content: "Run your community." },
    ],
  }),
  component: NodeDashboardLayout,
});

function NodeDashboardLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const context = Route.useRouteContext();
  const { selectedNode, summary, emptyReason } = context;

  if (!selectedNode || !summary) {
    const emptyState = getNodeEmptyStateContent(
      emptyReason ?? "no-node",
      context.auth.user?.role === "admin",
    );
    return (
      <PageContainer>
        <EmptyState
          icon={NetworkIcon}
          title={emptyState.title}
          description={emptyState.description}
          action={
            <Button nativeButton={false} render={<Link to={emptyState.actionTo} />}>
              {emptyState.actionLabel}
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const active = pathname.startsWith("/dashboard/node/proposals") ? "proposals" : "overview";

  return (
    <PageContainer variant="wide">
      <CommunityHeader
        headerTestId="dashboard-node.heading"
        nodeId={selectedNode.id}
        node={selectedNode}
        active={active}
      />
      <Outlet />
    </PageContainer>
  );
}
