import { ArrowSquareOutIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { type ApiClient, buildTenantUrl, getActiveRuntime, useApiClient } from "@/app";
import { Button, PageHeader, Skeleton } from "@/components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { nodeByIdQueryOptions, tenantNodesQueryOptions } from "@/lib/queries/nodes";
import { CommunityNav, type CommunityNavSection } from "./-community-nav";

type CommunityNode = NonNullable<Awaited<ReturnType<ApiClient["getNode"]>>>;

export function communityAuthContextQueryOptions(api: ApiClient, organizationId: string | null) {
  return queryOptions({
    queryKey: ["home-auth-context", organizationId ?? ""],
    queryFn: () => api.auth.getContext().catch(() => null),
    staleTime: 30 * 1000,
  });
}

export async function ensureCommunityHeaderData(
  context: {
    queryClient: QueryClient;
    apiClient: ApiClient;
    auth: { activeOrganizationId: string | null };
  },
  nodeId: string,
) {
  const { queryClient, apiClient } = context;
  const [node] = await Promise.all([
    queryClient.ensureQueryData(nodeByIdQueryOptions(apiClient, nodeId)).catch(() => null),
    queryClient
      .ensureQueryData(
        communityAuthContextQueryOptions(apiClient, context.auth.activeOrganizationId),
      )
      .catch(() => null),
  ]);
  if (node?.tenantId) {
    await queryClient
      .ensureQueryData(tenantNodesQueryOptions(apiClient, node.tenantId))
      .catch(() => null);
  }
}

export function CommunityHeader({
  nodeId,
  active,
  headerTestId,
  node: initialNode,
  replace = false,
  testIds,
}: {
  nodeId?: string;
  active: CommunityNavSection;
  headerTestId: string;
  node?: CommunityNode;
  replace?: boolean;
  testIds?: Partial<Record<CommunityNavSection, string>>;
}) {
  const api = useApiClient();
  const navigate = useNavigate();
  const { auth, runtimeConfig } = useRouteContext({ strict: false });
  const activeOrganizationId = auth?.activeOrganizationId ?? null;
  const gateway = getActiveRuntime(runtimeConfig)?.gatewayId;

  const nodeQuery = useQuery({
    ...nodeByIdQueryOptions(api, nodeId ?? ""),
    initialData: initialNode,
    enabled: !!nodeId,
  });
  const node = nodeQuery.data ?? undefined;

  const siblings = useQuery({
    ...tenantNodesQueryOptions(api, node?.tenantId ?? ""),
    enabled: !!node?.tenantId,
    select: (nodes) => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
  });
  const nodes = siblings.data ?? [];

  const authContext = useQuery(communityAuthContextQueryOptions(api, activeOrganizationId));
  const orgRole = authContext.data?.organization?.member?.role;
  const canManage = auth?.isAdmin || orgRole === "owner" || orgRole === "admin";

  const siteUrl = node && gateway ? buildTenantUrl(node.slug, gateway) : null;

  const switchTo = (targetId: string) => {
    if (active === "proposals") {
      void navigate({ to: "/dashboard/node/proposals", search: { nodeId: targetId } });
    } else if (active === "content" || active === "onboarding") {
      void navigate({
        to: "/nodes/$nodeId/content",
        params: { nodeId: targetId },
        search: { tab: active === "onboarding" ? "onboarding" : "events" },
      });
    } else {
      void navigate({ to: "/dashboard/node", search: { nodeId: targetId } });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        headerTestId={headerTestId}
        title={node?.name ?? <Skeleton className="h-10 w-64 max-w-full" />}
        description={
          node ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-base">
              <span className="capitalize">{node.kind}</span>
              {siteUrl && (
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 break-all hover:text-foreground"
                  data-testid="dashboard-node.site-link"
                >
                  {node.slug}.{gateway}
                  <ArrowSquareOutIcon className="size-4 shrink-0" />
                </a>
              )}
            </span>
          ) : (
            <Skeleton className="h-6 w-56 max-w-full" />
          )
        }
        actions={
          <>
            {node && nodes.length > 1 && (
              <Select
                value={node.id}
                items={nodes.map((item) => ({ label: item.name, value: item.id }))}
                onValueChange={(value) => {
                  if (value) switchTo(value);
                }}
              >
                <SelectTrigger
                  id="managed-node"
                  aria-label="Switch community"
                  className="w-full sm:w-auto"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {nodeId && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to="/explore" search={{ node: nodeId }} />}
              >
                View on Explore
                <ArrowUpRightIcon />
              </Button>
            )}
          </>
        }
      />
      {nodeId ? (
        <CommunityNav
          active={active}
          nodeId={nodeId}
          tenantId={node?.tenantId}
          canManage={canManage}
          replace={replace}
          testIds={testIds}
        />
      ) : (
        <Skeleton className="h-11 w-full max-w-md" />
      )}
    </div>
  );
}
