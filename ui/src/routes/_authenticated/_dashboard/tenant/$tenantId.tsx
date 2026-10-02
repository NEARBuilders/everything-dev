import { createFileRoute } from "@tanstack/react-router";
import { pageTitle } from "@/lib/page-title";
import { tenantNodesQueryOptions } from "@/lib/queries/nodes";
import { ensureCommunityHeaderData } from "../dashboard/node/-community-header";
import { TenantDetailContent } from "./-tenant-detail";

export const Route = createFileRoute("/_authenticated/_dashboard/tenant/$tenantId")({
  loader: async ({ context, params }) => {
    const nodes = await context.queryClient
      .ensureQueryData(tenantNodesQueryOptions(context.apiClient, params.tenantId))
      .catch(() => []);
    if (nodes[0]) await ensureCommunityHeaderData(context, nodes[0].id);
  },
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Community settings", match.context.runtimeConfig) }],
  }),
  component: TenantDetail,
});

function TenantDetail() {
  const { tenantId } = Route.useParams();
  const { runtimeConfig } = Route.useRouteContext();
  return <TenantDetailContent tenantId={tenantId} runtimeConfig={runtimeConfig} />;
}
