import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CoinsIcon,
  MagnifyingGlassIcon,
  MapPinAreaIcon,
  PlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getActiveRuntime, getGatewayId, useApiClient } from "@/app";
import { Button, EmptyState, NodeDirectory, SectionHeader } from "@/components";
import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { tenantAppsQueryOptions } from "@/lib/queries/tenants";

const PREVIEW_COUNT = 6;

const STEPS = [
  {
    icon: MagnifyingGlassIcon,
    title: "Find your place",
    body: "Pick a country, state or city from the directory.",
  },
  {
    icon: UsersThreeIcon,
    title: "Join the community",
    body: "See who's organizing and show up to the next event.",
  },
  {
    icon: CoinsIcon,
    title: "Stake NEAR",
    body: "Your stake keeps the local validator online and earns rewards.",
  },
];

export const Route = createFileRoute("/_public/")({
  loader: async ({ context }) => {
    await context.queryClient.prefetchQuery(tenantAppsQueryOptions(context.apiClient));
    return { runtimeConfig: context.runtimeConfig };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getActiveRuntime(loaderData?.runtimeConfig)?.title ?? "CityNode",
      },
      {
        name: "description",
        content:
          "CityNodes are local communities that each run a NEAR validator. Find yours, join its events, and stake to keep it online.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  const { runtimeConfig } = Route.useLoaderData();
  const apiClient = useApiClient();
  const gateway = getGatewayId(runtimeConfig);

  const { data: tenantApps = [], isLoading } = useQuery(tenantAppsQueryOptions(apiClient));

  const communities = tenantApps.flatMap((app) =>
    app.node
      ? [
          {
            id: app.accountId,
            name: app.node.name || app.name,
            slug: app.node.slug,
            kind: app.node.kind,
            hostname: app.hostname,
          },
        ]
      : [],
  );
  const counts = {
    communities: communities.length,
    cities: communities.filter((node) => node.kind === "city").length,
    regions: communities.filter((node) => node.kind !== "city").length,
  };

  return (
    <PageContainer variant="wide" className="gap-20 sm:gap-24">
      <section className="flex max-w-3xl flex-col gap-6 pt-4 sm:pt-10">
        <p className="flex items-center gap-2 text-sm font-medium text-brand-strong">
          <MapPinAreaIcon className="size-4" />
          Local communities on NEAR
        </p>
        <h1 className="text-5xl font-semibold text-balance text-foreground sm:text-6xl">
          Your city, on the network.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Local communities that each run a NEAR validator. Find yours, meet the people, and stake
          to keep it online.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            nativeButton={false}
            render={<Link to="/explore" data-testid="landing-explore" />}
          >
            Explore communities
            <ArrowRightIcon />
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link to="/apply" data-testid="landing-start" />}
          >
            Start a community
          </Button>
        </div>
        <dl
          data-testid="landing-stats"
          className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-6 sm:mt-6 sm:gap-6 sm:pt-8"
        >
          <Stat label="Communities" value={counts.communities} loading={isLoading} />
          <Stat label="Cities" value={counts.cities} loading={isLoading} />
          <Stat label="States & countries" value={counts.regions} loading={isLoading} />
        </dl>
      </section>

      <section className="flex flex-col gap-6" data-testid="landing-directory">
        <SectionHeader
          title="Communities"
          description="Events, local communities and staking pools."
          action={
            communities.length > 0 ? (
              <Button
                variant="ghost"
                nativeButton={false}
                render={<Link to="/explore" data-testid="landing-directory-all" />}
              >
                See all
                <ArrowRightIcon />
              </Button>
            ) : undefined
          }
        />
        <NodeDirectory
          nodes={communities.slice(0, PREVIEW_COUNT)}
          gateway={gateway}
          isLoading={isLoading}
          layout="grid"
          linkTo="/n/$slug"
          empty={
            <EmptyState
              icon={MapPinAreaIcon}
              title="No communities yet"
              description="Be the first to put your city on the network."
              className="rounded-3xl border border-dashed border-border py-12"
              action={
                <Button variant="outline" nativeButton={false} render={<Link to="/apply" />}>
                  <PlusIcon />
                  Start a community
                </Button>
              }
            />
          }
        />
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="How it works" />
        <ol className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-muted text-brand-strong">
                <step.icon className="size-6" />
              </span>
              <h3 className="text-lg font-medium text-foreground">
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6 border-t border-border pt-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">No node in your city yet?</h2>
          <p className="text-sm text-muted-foreground">
            Your organization proposes it and the network reviews it.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="outline" nativeButton={false} render={<Link to="/apply" />}>
            Start a community
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            render={(props) => (
              <a
                {...props}
                href="https://www.near.org/blog/legion-city-nodes"
                target="_blank"
                rel="noopener noreferrer"
              />
            )}
          >
            About City Nodes
            <ArrowUpRightIcon />
          </Button>
        </div>
      </section>
    </PageContainer>
  );
}

function Stat({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums text-foreground sm:text-4xl">
        {loading ? <Skeleton className="h-9 w-12" /> : value}
      </dd>
    </div>
  );
}
