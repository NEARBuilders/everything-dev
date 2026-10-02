import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarBlankIcon,
  CompassIcon,
  MapPinIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { type ApiClient, buildTenantUrl, getGatewayId, useApiClient } from "@/app";
import { Badge, Button, EmptyState, NodeDirectory, SectionHeader } from "@/components";
import { EventList } from "@/components/discovery/event-list";
import { PageContainer } from "@/components/layout/page-container";
import { NodeDirectorySkeleton } from "@/components/node-directory-skeleton";
import { NodeStakeSection } from "@/components/node-stake-section";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeKindLabel } from "@/lib/node-kind";
import { pageTitle } from "@/lib/page-title";
import {
  childNodesQueryOptions,
  nodeBySlugQueryOptions,
  stakingValidatorsQueryOptions,
} from "@/lib/queries/nodes";
import { ProposeHomepageCta } from "./-propose-homepage-cta";

function discoveryProfileQueryOptions(apiClient: ApiClient, nodeId: string) {
  return queryOptions({
    queryKey: ["discovery-node", nodeId],
    queryFn: () => apiClient.getDiscoveryNode({ nodeId }),
    enabled: !!nodeId,
    retry: false,
    staleTime: 30_000,
  });
}

export const Route = createFileRoute("/_public/n/$slug")({
  validateSearch: z.object({ parentId: z.uuid().optional() }),
  loaderDeps: ({ search }) => ({ parentId: search.parentId }),
  loader: async ({ params, context, deps: { parentId } }) => {
    const { queryClient, apiClient, runtimeConfig } = context;
    const slug = params.slug;

    const node = await queryClient.ensureQueryData(
      nodeBySlugQueryOptions(apiClient, slug, parentId),
    );

    if (node) {
      await Promise.all([
        queryClient.prefetchQuery(childNodesQueryOptions(apiClient, node.id)),
        queryClient.prefetchQuery(stakingValidatorsQueryOptions(apiClient, node.id)),
        queryClient.prefetchQuery(discoveryProfileQueryOptions(apiClient, node.id)),
      ]);
    }

    return { slug, parentId, runtimeConfig, nodeName: node?.name ?? null };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: pageTitle(loaderData?.nodeName ?? "Community", loaderData?.runtimeConfig),
      },
      {
        name: "description",
        content: loaderData?.nodeName
          ? `${loaderData.nodeName} on CityNode — events, local communities and staking pools.`
          : "A local community on CityNode.",
      },
    ],
  }),
  component: NodePage,
});

function NodePage() {
  const { slug, parentId, runtimeConfig } = Route.useLoaderData();
  const apiClient = useApiClient();
  const gateway = getGatewayId(runtimeConfig);

  const { data: node, isLoading: nodeLoading } = useQuery(
    nodeBySlugQueryOptions(apiClient, slug, parentId),
  );

  const nodeId = node?.id;

  const { data: children = [], isLoading: childrenLoading } = useQuery({
    ...childNodesQueryOptions(apiClient, nodeId ?? ""),
    enabled: !!nodeId,
  });

  const { data: staking } = useQuery({
    ...stakingValidatorsQueryOptions(apiClient, nodeId ?? ""),
    enabled: !!nodeId,
  });

  const { data: profile } = useQuery(discoveryProfileQueryOptions(apiClient, nodeId ?? ""));

  if (nodeLoading) {
    return (
      <PageContainer variant="default">
        <NodeSkeleton />
      </PageContainer>
    );
  }

  if (!node) {
    return (
      <PageContainer variant="default">
        <EmptyState
          icon={CompassIcon}
          title="Community not found"
          description={`There's no community at /n/${slug}. It may have moved or not exist yet.`}
          action={
            <Button
              nativeButton={false}
              render={<Link to="/explore" data-testid="node-page.back-to-explore" />}
            >
              Back to Explore
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const validators = staking?.validators ?? [];
  const validatorNodeIds = new Set(validators.map((v) => v.nodeId));
  const events = profile?.events ?? [];
  const hostname = gateway ? `${node.slug}.${gateway}` : null;
  const siteUrl =
    hostname && gateway
      ? (buildTenantUrl(hostname, gateway, { path: "/" }) ?? `https://${hostname}/`)
      : null;
  const kindLabel = nodeKindLabel(node.kind);

  return (
    <PageContainer variant="default">
      <header className="flex flex-col gap-6" data-testid="node-page.header">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{kindLabel}</Badge>
          {profile?.location && (
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPinIcon className="size-4 shrink-0" />
              {profile.location}
            </span>
          )}
          {profile?.featured && (
            <Badge>
              <SparkleIcon />
              {profile.featured}
            </Badge>
          )}
          {profile?.active && <Badge variant="success">Recently active</Badge>}
        </div>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="text-3xl font-semibold wrap-anywhere text-foreground sm:text-4xl">
              {node.name}
            </h1>
            {profile?.summary ? (
              <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">
                {profile.summary}
              </p>
            ) : (
              <p className="text-sm break-all text-muted-foreground">{hostname}</p>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:shrink-0 sm:flex-row">
            {validators.length > 0 && (
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/stake"
                    search={{ nodeId: node.id }}
                    data-testid="node-page.stake-button"
                  />
                }
              >
                Stake NEAR
                <ArrowRightIcon />
              </Button>
            )}
            {siteUrl && (
              <Button
                variant="outline"
                nativeButton={false}
                render={(props) => (
                  <a
                    {...props}
                    href={siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="node-page.visit-site"
                  />
                )}
              >
                Visit site
                <ArrowUpRightIcon />
              </Button>
            )}
            <ProposeHomepageCta tenantId={node.tenantId} />
          </div>
        </div>
        {profile && profile.channels.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {profile.channels.map((channel) => (
              <Button
                key={channel.url}
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={(props) => (
                  <a {...props} href={channel.url} target="_blank" rel="noopener noreferrer" />
                )}
              >
                {channel.label}
                <ArrowUpRightIcon />
              </Button>
            ))}
          </div>
        )}
      </header>

      <dl
        data-testid="node-page.stats"
        className="grid grid-cols-3 gap-4 border-y border-border py-6 sm:gap-6"
      >
        <Stat label="Upcoming events" value={events.length} />
        <Stat
          label={children.length === 1 ? "Local community" : "Local communities"}
          value={children.length}
        />
        <Stat
          label={validators.length === 1 ? "Staking pool" : "Staking pools"}
          value={validators.length}
        />
      </dl>

      <section className="flex flex-col gap-6" data-testid="node-page.events">
        <SectionHeader title="Upcoming events" />
        {events.length > 0 ? (
          <EventList events={events} nodeId={node.id} />
        ) : (
          <div className="flex items-center gap-4 rounded-2xl bg-muted p-6">
            <CalendarBlankIcon className="size-6 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
          </div>
        )}
      </section>

      {(childrenLoading || children.length > 0) && (
        <section className="flex flex-col gap-6" data-testid="node-page.children">
          <SectionHeader
            title="Local communities"
            description={`States and cities under ${node.name}.`}
          />
          <NodeDirectory
            nodes={children}
            gateway={gateway}
            validatorNodeIds={validatorNodeIds}
            isLoading={childrenLoading}
            layout="grid"
            linkTo="/n/$slug"
          />
        </section>
      )}

      <NodeStakeSection
        node={node}
        children={children}
        gateway={gateway}
        validators={validators}
        sourceNodeId={staking?.sourceNodeId ?? node.id}
        apiClient={apiClient}
      />
    </PageContainer>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function NodeSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-4">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </header>
      <Skeleton className="h-20 w-full" />
      <NodeDirectorySkeleton layout="grid" />
    </div>
  );
}
