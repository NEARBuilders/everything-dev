import { GasPumpIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { getAccount } from "@/app";
import { Button, PageContainer } from "@/components";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { pageTitle } from "@/lib/page-title";
import { organizationByIdQueryOptions } from "@/lib/queries/organizations";
import { useRelayerInfoQuery } from "@/lib/use-relayer";

export const Route = createFileRoute("/_admin/_dashboard/admin")({
  beforeLoad: async ({ context }) => {
    const { apiClient, queryClient, runtimeConfig } = context;
    const accountId = getAccount(runtimeConfig);
    let tenant: Awaited<ReturnType<typeof apiClient.resolveTenant>> | null = null;
    try {
      tenant = await apiClient.resolveTenant({ accountId });
    } catch {
      tenant = null;
    }
    const tenantOrganization = tenant?.orgId
      ? await queryClient
          .ensureQueryData(organizationByIdQueryOptions(apiClient, tenant.orgId))
          .catch(() => null)
      : null;
    const tenantOrganizationSlug = tenantOrganization?.slug ?? null;
    return { tenant, tenantOrganizationSlug };
  },
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Admin", match.context.runtimeConfig) }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <PageContainer variant="wide">
      <RelayerFundingNotice />
      <Outlet />
    </PageContainer>
  );
}

function RelayerFundingNotice() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: relayerInfo } = useRelayerInfoQuery();
  const needsFunding = !!relayerInfo && relayerInfo.enabled === false && !!relayerInfo.accountId;
  if (!needsFunding || pathname.startsWith("/admin/relayer")) return null;

  return (
    <Item variant="outline" data-testid="admin-relayer-notice">
      <ItemMedia variant="icon">
        <GasPumpIcon className="text-destructive" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>Relayer needs funding</ItemTitle>
        <ItemDescription>Gasless writes are paused until the relayer has NEAR.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/admin/relayer" />}
        >
          Fund relayer
        </Button>
      </ItemActions>
    </Item>
  );
}
