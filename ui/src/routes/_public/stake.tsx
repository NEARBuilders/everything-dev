import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { getGatewayId, sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { PageContainer, PageHeader, SectionHeader } from "@/components";
import { Button } from "@/components/ui/button";
import { parseNearAmount } from "@/lib/near-amount";
import { pageTitle } from "@/lib/page-title";
import {
  childNodesQueryOptions,
  nodeByIdQueryOptions,
  nodeBySlugQueryOptions,
  stakingValidatorsQueryOptions,
} from "@/lib/queries/nodes";
import { stakeCommunitiesQueryOptions } from "@/lib/queries/tenants";
import { requireTeamArea } from "@/lib/team-workspace";
import { useNearAccount } from "@/lib/use-near-account";
import { StakeDirectory } from "./-stake-directory";
import { StakeForm } from "./-stake-form";
import { useStakeMutation, useStakeWalletConnection } from "./-stake-mutations";
import { StakeNodeContent } from "./-stake-node-content";
import { StakeOnramp } from "./-stake-onramp";
import { getActiveOrganizationNodeId, getStakeScopeKey } from "./-stake-selection";
import { StakeSkeleton } from "./-stake-skeleton";

export const Route = createFileRoute("/_public/stake")({
  validateSearch: z.object({ node: z.string().optional(), nodeId: z.uuid().optional() }),
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient
      .query(sessionQueryOptions(context.authClient))
      .catch(() => null);
    if (session?.user) await requireTeamArea({ context, location });
  },
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Stake", match.context.runtimeConfig) },
      { name: "description", content: "Stake NEAR to back a CityNode community." },
    ],
  }),
  component: StakePage,
});

type ApiClient = ReturnType<typeof useApiClient>;
type TenantApp = Awaited<ReturnType<ApiClient["listStakeCommunities"]>>[number];
type Node = Awaited<ReturnType<ApiClient["getNode"]>>;

function getDirectoryNodes(tenantApps: TenantApp[]) {
  return tenantApps.flatMap((app) =>
    app.node
      ? [
          {
            id: app.node.id,
            name: app.name,
            slug: app.node.slug,
            kind: app.node.kind,
            hostname: app.hostname,
          },
        ]
      : [],
  );
}

function getStakeTitle(node: Node | undefined, slug: string | null, loading: boolean): ReactNode {
  if (node) return `Stake to ${node.name}`;
  if (slug && loading)
    return (
      <>
        Stake to <span className="capitalize">{slug}</span>
      </>
    );
  return "Stake";
}

function hasInheritedValidator(node: Node | undefined, sourceNodeId: string | null | undefined) {
  return !!node && !!sourceNodeId && sourceNodeId !== node.id;
}

function getSlugFromHostname(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname;
  if (host === "localhost" || host.includes("localhost")) return null;
  const parts = host.split(".");
  if (parts.length <= 2) return null;
  const slug = parts[0];
  if (slug === "www") return null;
  return slug;
}

function StakePage() {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const { node: nodeSlug, nodeId: requestedNodeId } = Route.useSearch();
  const hostnameSlug = getSlugFromHostname();
  const requestedSlug = nodeSlug ?? hostnameSlug;
  const hasRequestedNode = !!requestedNodeId || !!requestedSlug;
  const { runtimeConfig, session: contextSession } = Route.useRouteContext();
  const { data: session = contextSession } = useQuery(sessionQueryOptions(auth));
  const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
  const stakeScopeKey = getStakeScopeKey(session?.user, activeOrganizationId);
  const href = useRouterState({ select: (state) => state.location.href });
  const gateway = getGatewayId(runtimeConfig);
  const { data: tenantApps = [], isLoading: directoryLoading } = useQuery({
    ...stakeCommunitiesQueryOptions(apiClient, stakeScopeKey),
    enabled: !hasRequestedNode,
  });
  const directoryNodes = useMemo(() => getDirectoryNodes(tenantApps), [tenantApps]);
  const defaultNodeId = getActiveOrganizationNodeId({
    activeOrganizationId,
    communities: tenantApps,
    hasRequestedNode,
  });
  const selectedNodeId = requestedNodeId ?? defaultNodeId;
  const slug = selectedNodeId ? null : requestedSlug;
  const hasNodeSelection = !!selectedNodeId || !!slug;
  const resolvingActiveOrganization =
    !!activeOrganizationId && !hasRequestedNode && directoryLoading;
  const nearAccountId = useNearAccount();
  const [amount, setAmount] = useState("1");
  const [selectedValidatorId, setSelectedValidatorId] = useState<string | null>(null);
  const { connect: handleConnectWallet, isConnecting: connectingWallet } =
    useStakeWalletConnection(auth);

  const nodeById = useQuery({
    ...nodeByIdQueryOptions(apiClient, selectedNodeId ?? ""),
    enabled: !!selectedNodeId,
  });
  const nodeBySlug = useQuery({
    ...nodeBySlugQueryOptions(apiClient, slug ?? ""),
    enabled: !selectedNodeId && !!slug,
  });
  const { data: node, isLoading: nodeLoading } = selectedNodeId ? nodeById : nodeBySlug;
  const nodeId = node?.id;
  const { data: staking, isLoading: stakingLoading } = useQuery({
    ...stakingValidatorsQueryOptions(apiClient, nodeId ?? ""),
    enabled: !!nodeId,
  });
  const validators = useMemo(() => staking?.validators ?? [], [staking?.validators]);
  const isInherited = hasInheritedValidator(node, staking?.sourceNodeId);
  const { data: sourceNode } = useQuery({
    ...nodeByIdQueryOptions(apiClient, staking?.sourceNodeId ?? ""),
    enabled: isInherited,
  });
  const { data: children = [] } = useQuery({
    ...childNodesQueryOptions(apiClient, nodeId ?? ""),
    enabled: !!nodeId && validators.length === 0,
  });
  const defaultValidator = useMemo(
    () => validators.find((validator) => validator.isDefault) ?? validators[0] ?? null,
    [validators],
  );
  const selectedValidator =
    validators.find((validator) => validator.id === selectedValidatorId) ?? defaultValidator;
  const parsedYocto = useMemo(() => parseNearAmount(amount), [amount]);

  const stakeMutation = useStakeMutation(auth, queryClient);

  const form = (
    <StakeForm
      amount={amount}
      connectingWallet={connectingWallet}
      isPending={stakeMutation.isPending}
      nearAccountId={nearAccountId}
      onAmountChange={setAmount}
      onConnect={() => void handleConnectWallet()}
      onStake={(variables) => stakeMutation.mutate(variables)}
      parsedYocto={parsedYocto}
      signInRedirect={session?.user ? null : href}
      validator={selectedValidator}
    />
  );

  if (resolvingActiveOrganization) {
    return (
      <PageContainer>
        <PageHeader
          headerTestId="stake.heading"
          title="Stake"
          description="Back a community by staking NEAR to its validator."
        />
        <StakeSkeleton />
      </PageContainer>
    );
  }

  if (!hasNodeSelection) {
    return (
      <PageContainer>
        <PageHeader
          headerTestId="stake.heading"
          title="Stake"
          description="Back a community by staking NEAR to its validator."
        />
        <section className="flex flex-col gap-6">
          <SectionHeader title="Pick a community" />
          <StakeDirectory nodes={directoryNodes} gateway={gateway} isLoading={directoryLoading} />
        </section>
        <StakeOnramp />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-4">
        {(nodeSlug || selectedNodeId) && (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start"
            nativeButton={false}
            data-testid="stake.back"
            render={<Link to="/stake" />}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            All communities
          </Button>
        )}
        <PageHeader headerTestId="stake.heading" title={getStakeTitle(node, slug, nodeLoading)} />
      </div>
      <StakeNodeContent
        aside={
          <>
            {form}
            <StakeOnramp />
          </>
        }
        childNodes={children}
        isInherited={isInherited}
        node={node}
        nodeLoading={nodeLoading}
        onSelectValidator={setSelectedValidatorId}
        selectedValidatorId={selectedValidator?.id ?? null}
        sourceNode={sourceNode}
        stakingLoading={stakingLoading}
        validators={validators}
      />
    </PageContainer>
  );
}
