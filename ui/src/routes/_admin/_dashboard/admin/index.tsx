import {
  BuildingsIcon,
  CaretRightIcon,
  CheckCircleIcon,
  GasPumpIcon,
  GavelIcon,
  GearIcon,
  TreeStructureIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, type LinkProps } from "@tanstack/react-router";
import { cn } from "cn";
import type { ComponentType, ReactNode } from "react";
import { getAccount, useApiClient } from "@/app";
import { Badge, Button, EmptyState, LocalDate, PageHeader, SectionHeader } from "@/components";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { pageTitle } from "@/lib/page-title";
import { allNodesQueryOptions } from "@/lib/queries/nodes";
import { tenantsQueryOptions } from "@/lib/queries/tenants";
import { useNearAccount } from "@/lib/use-near-account";
import { useRelayerInfoQuery } from "@/lib/use-relayer";
import { formatNearFigure, ListSkeleton, StatFigure, StatGrid } from "./-admin-ui";
import {
  adminProposalListQueryOptions,
  proposalTitle,
  proposalTypeLabel,
} from "./proposals/-proposal-review";

const QUEUE_SIZE = 5;

export const Route = createFileRoute("/_admin/_dashboard/admin/")({
  loader: ({ context }) =>
    context.queryClient.ensureInfiniteQueryData(
      adminProposalListQueryOptions(context.apiClient, "pending"),
    ),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Admin", match.context.runtimeConfig) }],
  }),
  component: AdminOverview,
});

function AdminOverview() {
  const { auth, tenant, tenantOrganizationSlug, runtimeConfig } = Route.useRouteContext();
  const apiClient = useApiClient();
  const platformAccount = getAccount(runtimeConfig);
  const user = auth?.user ?? null;
  const walletAccount = useNearAccount();

  const pendingQuery = useInfiniteQuery(adminProposalListQueryOptions(apiClient, "pending"));
  const nodesQuery = useQuery(allNodesQueryOptions(apiClient));
  const tenantsQuery = useQuery(tenantsQueryOptions(apiClient));
  const relayerQuery = useRelayerInfoQuery();

  const pending = pendingQuery.data?.pages[0]?.data ?? [];
  const pendingTotal = pendingQuery.data?.pages[0]?.meta.total;
  const relayer = relayerQuery.data;

  return (
    <>
      <PageHeader title="Admin" subtitle={platformAccount} headerTestId="admin.heading" />

      <StatGrid>
        <StatFigure
          label="Waiting for review"
          value={pendingTotal ?? "—"}
          tone={pendingTotal ? "attention" : "default"}
          testId="admin.stat.pending-proposals"
        />
        <StatFigure
          label="Communities"
          value={nodesQuery.data?.length ?? "—"}
          testId="admin.stat.nodes"
        />
        <StatFigure
          label="Sites"
          value={tenantsQuery.data?.length ?? "—"}
          testId="admin.stat.tenants"
        />
        <StatFigure
          label="Relayer balance"
          value={relayer?.enabled ? formatNearFigure(relayer.balance) : relayer ? "0" : "—"}
          hint={relayer ? (relayer.enabled ? "NEAR" : "Needs funding") : "Not configured"}
          tone={relayer && !relayer.enabled ? "attention" : "default"}
          testId="admin.stat.relayer"
        />
      </StatGrid>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Waiting for review"
          sectionTestId="admin.section.queue"
          action={
            pendingTotal ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to="/admin/proposals" search={{ status: "pending" }} />}
              >
                See all {pendingTotal}
              </Button>
            ) : undefined
          }
        />
        {pendingQuery.isLoading ? (
          <ListSkeleton rows={3} />
        ) : pendingQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn't load proposals: {pendingQuery.error.message}
          </p>
        ) : pending.length === 0 ? (
          <EmptyState
            icon={CheckCircleIcon}
            title="All caught up"
            description="New community applications and submissions show up here."
            className="py-10"
          />
        ) : (
          <ItemGroup data-testid="admin-queue">
            {pending.slice(0, QUEUE_SIZE).map((proposal) => (
              <Item
                key={proposal.id}
                variant="outline"
                render={
                  <Link
                    to="/admin/proposals/$proposalId"
                    params={{ proposalId: proposal.id }}
                    search={{ pluginId: proposal.pluginId, entityId: proposal.entityId }}
                  />
                }
                data-testid={`admin-queue-item-${proposal.id}`}
              >
                <ItemMedia variant="icon">
                  <GavelIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="min-w-0 truncate">{proposalTitle(proposal)}</span>
                  </ItemTitle>
                  <ItemDescription>
                    {proposalTypeLabel(proposal.pluginId)} · submitted{" "}
                    <LocalDate value={proposal.createdAt} format="relative" />
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <span className="hidden text-sm font-medium sm:inline">Review</span>
                  <CaretRightIcon className="size-4 text-muted-foreground" />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="Manage" sectionTestId="admin.section.manage" />
        <ItemGroup>
          <ManageRow
            to="/admin/nodes"
            icon={TreeStructureIcon}
            title="Communities"
            testId="admin.heading.nodes"
            description="The community tree, validators and domains"
          />
          <ManageRow
            to="/admin/proposals"
            icon={GavelIcon}
            title="Proposals"
            testId="admin.heading.proposals"
            description="Every application and decision"
            badge={pendingTotal ? <Badge variant="warning">{pendingTotal} pending</Badge> : null}
          />
          <ManageRow
            to="/admin/tenants"
            icon={BuildingsIcon}
            title="Sites"
            testId="admin.heading.tenants"
            description="Deployments and their DAOs"
          />
          <ManageRow
            to="/orgs"
            icon={UsersIcon}
            title="Organizations"
            testId="admin.heading.organizations"
            description="Members, teams and invitations"
          />
          <ManageRow
            to="/admin/relayer"
            icon={GasPumpIcon}
            title="Relayer"
            testId="admin.heading.relayer"
            description="Gas for gasless writes"
          />
          <ManageRow
            to="/admin/system"
            icon={GearIcon}
            title="System"
            testId="admin.heading.system"
            description="Runtime configuration and endpoints"
          />
        </ItemGroup>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="This runtime" />
        <div className="flex flex-col">
          <ContextRow label="Platform account" value={platformAccount} mono />
          {tenant && <ContextRow label="Site" value={tenant.name} />}
          {tenant && (
            <ContextRow
              label="Organization"
              value={
                tenantOrganizationSlug ? (
                  <Link
                    to="/orgs/$slug"
                    params={{ slug: tenantOrganizationSlug }}
                    className="hover:underline"
                  >
                    {tenantOrganizationSlug}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
          )}
          {tenant?.createdAt && (
            <ContextRow label="Created" value={<LocalDate value={tenant.createdAt} />} />
          )}
          <ContextRow label="Name" value={user?.name || user?.email || "—"} />
          <ContextRow label="Role" value={user?.role ?? "—"} />
          <ContextRow
            label="Wallet"
            value={walletAccount ?? "Not connected"}
            mono={!!walletAccount}
          />
        </div>
      </section>
    </>
  );
}

function ManageRow({
  to,
  icon: Icon,
  title,
  description,
  testId,
  badge,
}: {
  to: LinkProps["to"];
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  testId: string;
  badge?: ReactNode;
}) {
  return (
    <Item variant="outline" size="sm" render={<Link to={to} />}>
      <ItemMedia variant="icon">
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          <h3 className="min-w-0 truncate" data-testid={testId}>
            {title}
          </h3>
          {badge}
        </ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <CaretRightIcon className="size-4 text-muted-foreground" />
      </ItemActions>
    </Item>
  );
}

function ContextRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  const slug = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div
      className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
      data-testid={`admin.stat.${slug}`}
    >
      <span className="text-sm text-muted-foreground" data-testid={`admin.stat.${slug}.label`}>
        {label}
      </span>
      <span
        className={cn("text-sm break-all text-foreground sm:text-right", mono && "font-mono")}
        data-testid={`admin.stat.${slug}.value`}
      >
        {value}
      </span>
    </div>
  );
}
