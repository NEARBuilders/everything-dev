import {
  ArrowSquareOutIcon,
  CalendarDotsIcon,
  HourglassMediumIcon,
  QrCodeIcon,
  TreeStructureIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  buildTenantUrl,
  getActiveRuntime,
  type Organization,
  useApiClient,
  useAuthClient,
} from "@/app";
import {
  Badge,
  Button,
  LocalDate,
  NodeValidatorTable,
  SectionHeader,
  TeamStakeCard,
} from "@/components";
import { EventDate, upcomingEvents } from "@/components/discovery/event-onboarding";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { resolveTeamStakeTarget } from "@/lib/queries/stake-pool";
import {
  CONFIG_WRITE_PLAN,
  fetchDaoProposals,
  findPendingProposalForPlan,
} from "@/lib/sputnik-proposals";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboard/node/")({
  component: NodeOverview,
});

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function NodeOverview() {
  const { runtimeConfig, selectedNode, summary, stakingSourceNode, tenant, auth, canManage } =
    Route.useRouteContext();
  const apiClient = useApiClient();
  const authClient = useAuthClient();
  const [now] = useState(() => Date.now());
  const orgId = tenant?.orgId ?? auth.activeOrganizationId;
  const nodeId = selectedNode?.id ?? "";
  const daoQuery = useQuery({
    queryKey: ["org-dao", orgId],
    enabled: !!orgId && !!selectedNode && !!summary,
    staleTime: 60_000,
    queryFn: () =>
      apiClient.auth.getDao({ organizationId: orgId ?? "" }).catch(() => ({
        daoAccountId: null,
        daoNetwork: null,
      })),
  });
  const activities = useQuery({
    queryKey: ["discovery-activities", nodeId],
    queryFn: () => apiClient.listDiscoveryActivities({ nodeId }),
    enabled: !!nodeId,
    retry: false,
  });
  const daoOwned = !!tenant && tenant.ownerKind === "dao";
  const pendingConfigQuery = useQuery({
    queryKey: ["dashboard-node", "pending-config-proposal", tenant?.accountId],
    queryFn: async () => {
      const proposals = await fetchDaoProposals(tenant?.accountId ?? "");
      return findPendingProposalForPlan(proposals, CONFIG_WRITE_PLAN);
    },
    enabled: daoOwned && canManage && !!tenant?.accountId,
    refetchInterval: 15_000,
  });
  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await authClient.organization.list();
      return (data || []) as Organization[];
    },
    enabled: daoOwned && canManage && !!orgId,
    staleTime: 30_000,
  });
  if (!selectedNode || !summary) return null;

  const pendingConfig = pendingConfigQuery.data ?? null;
  const orgSlug = orgsQuery.data?.find((org) => org.id === orgId)?.slug ?? null;

  const gateway = getActiveRuntime(runtimeConfig)?.gatewayId;
  const stakingIsInherited = summary.stakingValidators.sourceNodeId !== selectedNode.id;
  const teamStake = resolveTeamStakeTarget({
    daoAccountId: daoQuery.data?.daoAccountId,
    tenantAccountId: tenant?.accountId,
    tenantOwnerKind: tenant?.ownerKind,
    validators: summary.stakingValidators.validators,
  });
  const upcoming = upcomingEvents(activities.data ?? [], now);
  const contentLink = (tab: "events" | "onboarding") => (
    <Link to="/nodes/$nodeId/content" params={{ nodeId: selectedNode.id }} search={{ tab }} />
  );

  return (
    <div className="flex flex-col gap-12">
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat
          label="Upcoming events"
          value={activities.isSuccess ? String(upcoming.length) : "—"}
          testId="dashboard-node.stat-events"
        />
        <Stat
          label="Validators"
          value={String(summary.validators.length)}
          testId="dashboard-node.stat-validators"
        />
        <Stat
          label="Sub-communities"
          value={String(summary.children.length)}
          testId="dashboard-node.stat-children"
        />
        <Stat
          label="Staking"
          value={
            summary.stakingValidators.validators.length === 0
              ? "—"
              : stakingIsInherited
                ? "Inherited"
                : "Own"
          }
          testId="dashboard-node.stat-staking"
        />
      </dl>

      {daoOwned && canManage && pendingConfig && orgSlug && (
        <Item variant="outline" data-testid="dashboard-node.pending-config-proposal">
          <ItemMedia variant="icon">
            <HourglassMediumIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>Awaiting votes · #{pendingConfig.id}</ItemTitle>
            <ItemDescription>
              A community config change (e.g. a custom UI bundle) is waiting for DAO approval.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link to="/orgs/$slug" params={{ slug: orgSlug }} search={{ tab: "node-config" }} />
              }
              data-testid="dashboard-node.pending-config-open"
            >
              Review
            </Button>
          </ItemActions>
        </Item>
      )}

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Coming up"
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={contentLink("events")}
              data-testid="dashboard-node.add-event"
            >
              <CalendarDotsIcon />
              Add event
            </Button>
          }
        />
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {activities.isError
              ? "Events are managed by this community's owners."
              : "Nothing scheduled. Add an event to show up on Explore."}
          </p>
        ) : (
          <ItemGroup>
            {upcoming.slice(0, 3).map((event) => (
              <Item key={event.id} variant="outline">
                <ItemMedia>
                  <EventDate value={event.startsAt} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    {event.title}
                    {event.status === "draft" && <Badge variant="secondary">Draft</Badge>}
                  </ItemTitle>
                  <ItemDescription>
                    {event.startsAt && <LocalDate value={event.startsAt} format="datetime" />}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={contentLink("onboarding")}
                    aria-label={`Onboarding for ${event.title}`}
                  >
                    <QrCodeIcon />
                    <span className="hidden sm:inline">Onboarding</span>
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </section>

      <TeamStakeCard target={teamStake} pending={daoQuery.isLoading} />

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Validators"
          description={
            stakingIsInherited
              ? `Stake goes to ${stakingSourceNode?.name ?? "a parent community"}'s validators.`
              : "Stake goes to this community's validators."
          }
        />
        {summary.stakingValidators.validators.length === 0 && summary.validators.length === 0 ? (
          <p className="text-sm text-muted-foreground">No validators yet.</p>
        ) : (
          <NodeValidatorTable
            validators={
              summary.stakingValidators.validators.length > 0
                ? summary.stakingValidators.validators
                : summary.validators
            }
          />
        )}
      </section>

      {summary.children.length > 0 && (
        <section className="flex flex-col gap-6">
          <SectionHeader title="Sub-communities" />
          <ItemGroup>
            {summary.children.map((child) => {
              const childUrl = gateway ? buildTenantUrl(child.slug, gateway) : null;
              return (
                <Item key={child.id} variant="outline" size="sm">
                  <ItemMedia variant="icon">
                    <TreeStructureIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{child.name}</ItemTitle>
                    <ItemDescription>
                      <span className="capitalize">{child.kind}</span>
                    </ItemDescription>
                  </ItemContent>
                  {childUrl && (
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        nativeButton={false}
                        render={(props) => (
                          <a {...props} href={childUrl} target="_blank" rel="noopener noreferrer" />
                        )}
                      >
                        Visit
                        <ArrowSquareOutIcon />
                      </Button>
                    </ItemActions>
                  )}
                </Item>
              );
            })}
          </ItemGroup>
        </section>
      )}
    </div>
  );
}
