import {
  ArrowUpIcon,
  BroadcastIcon,
  CaretRightIcon,
  CubeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useApiClient } from "@/app";
import { Badge, Button, EmptyState, LocalDate, PageContainer, PageHeader } from "@/components";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/page-title";
import { thingQueryKeys } from "./-thing-cache";
import { filterThings } from "./-thing-list";

type ApiClient = ReturnType<typeof useApiClient>;
type Thing = Awaited<ReturnType<ApiClient["template"]["listThings"]>>["data"][number];

const EMPTY_THINGS: Thing[] = [];

export const Route = createFileRoute("/_authenticated/_dashboard/things/")({
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Things", match.context.runtimeConfig) },
      {
        name: "description",
        content: "Browse approved Things.",
      },
    ],
  }),
  component: ThingsIndexPage,
});

function ThingsIndexPage() {
  const apiClient = useApiClient();
  const [query, setQuery] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: thingQueryKeys.list,
    queryFn: () => apiClient.template.listThings({ limit: 50 }),
    staleTime: 30 * 1000,
  });

  const things = data?.data ?? EMPTY_THINGS;
  const thingIds = useMemo(() => things.map((thing) => thing.thingId), [things]);
  const visibleThings = useMemo(() => filterThings(things, query), [things, query]);

  const upvoteCountsQuery = useQuery({
    queryKey: [...thingQueryKeys.upvoteCounts, thingIds],
    queryFn: () => apiClient.votes.getUpvoteCounts({ entityIds: thingIds }),
    enabled: thingIds.length > 0,
    staleTime: 30 * 1000,
  });

  const newThingButton = (
    <Button nativeButton={false} render={<Link to="/things/new" />} data-testid="things-new">
      <PlusIcon />
      New thing
    </Button>
  );

  return (
    <PageContainer variant="default">
      <PageHeader
        title="Things"
        description="Approved things in the registry."
        headerTestId="things.heading"
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/things/live" />}
              data-testid="things-live"
            >
              <BroadcastIcon />
              Live
            </Button>
            {newThingButton}
          </>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-11 w-full max-w-sm" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <EmptyState
          icon={CubeIcon}
          title="Couldn't load things"
          description={error.message}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : things.length === 0 ? (
        <EmptyState
          icon={CubeIcon}
          title="No things yet"
          description="Propose the first one. An admin reviews it before it goes live."
          action={newThingButton}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InputGroup className="w-full sm:max-w-sm">
              <InputGroupAddon>
                <MagnifyingGlassIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search things"
                placeholder="Search by id or type"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                data-testid="things-search"
              />
            </InputGroup>
            <span className="text-sm text-muted-foreground tabular-nums">
              {visibleThings.length === things.length
                ? `${things.length} ${things.length === 1 ? "thing" : "things"}`
                : `${visibleThings.length} of ${things.length}`}
            </span>
          </div>

          {visibleThings.length === 0 ? (
            <EmptyState
              icon={MagnifyingGlassIcon}
              title="No matches"
              description={`Nothing matches “${query.trim()}”.`}
              action={
                <Button variant="outline" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <ItemGroup data-testid="things-list">
              {visibleThings.map((thing) => (
                <Item
                  key={thing.thingId}
                  variant="outline"
                  size="sm"
                  role="listitem"
                  render={<Link to="/things/$thingId" params={{ thingId: thing.thingId }} />}
                  data-testid={`things-row-${thing.thingId}`}
                >
                  <ItemMedia variant="icon">
                    <CubeIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="truncate font-mono">{thing.thingId}</span>
                    </ItemTitle>
                    <ItemDescription>
                      Updated <LocalDate value={thing.updatedAt} format="relative" />
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline" className="hidden font-mono sm:inline-flex">
                      {thing.type}
                    </Badge>
                    <span className="inline-flex min-w-10 items-center justify-end gap-1 text-sm text-muted-foreground tabular-nums">
                      <ArrowUpIcon />
                      {upvoteCountsQuery.isLoading
                        ? "—"
                        : (upvoteCountsQuery.data?.[thing.thingId]?.totalCount ?? 0)}
                      <span className="sr-only">upvotes</span>
                    </span>
                    <CaretRightIcon className="text-muted-foreground" />
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </div>
      )}
    </PageContainer>
  );
}
