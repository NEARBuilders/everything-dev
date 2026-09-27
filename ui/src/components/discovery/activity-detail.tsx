import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CalendarXIcon,
  ClockIcon,
  MapPinIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useApiClient } from "@/app";
import { Badge, Button, EmptyState } from "@/components";
import { Skeleton } from "@/components/ui/skeleton";
import { useDiscoveryMeasurement } from "./discovery-measurement";
import { activityDateTile, activityTimeRange, DateTile } from "./event-list";
import { ReportContent } from "./report-content";

export function ActivityDetail({
  activityId,
  node,
  campaign,
}: {
  activityId: string;
  node?: string;
  campaign?: string;
}) {
  const api = useApiClient();
  const measurement = useDiscoveryMeasurement(api, campaign);
  const activity = useQuery({
    queryKey: ["discovery-activity", activityId],
    queryFn: () => api.getDiscoveryActivity({ id: activityId }),
    refetchInterval: 30_000,
  });
  const selectedNode =
    node && activity.data?.nodeIds.includes(node) ? node : activity.data?.ownerNodeId;
  const host = useQuery({
    queryKey: ["discovery-node", selectedNode],
    queryFn: () => api.getDiscoveryNode({ nodeId: selectedNode! }),
    enabled: !!selectedNode,
    retry: false,
    staleTime: 30_000,
  });

  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="self-start"
      nativeButton={false}
      render={
        <Link to="/explore" search={{ node: selectedNode, campaign }} data-testid="activity.back" />
      }
    >
      <ArrowLeftIcon />
      Back to Explore
    </Button>
  );

  if (activity.isPending) {
    return (
      <div className="flex flex-col gap-8" role="status" aria-label="Loading">
        {back}
        <div className="flex items-center gap-5">
          <Skeleton className="size-20 rounded-xl" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (activity.isError || !activity.data) {
    return (
      <div className="flex flex-col gap-8">
        {back}
        <EmptyState
          icon={CalendarXIcon}
          title={activity.isError ? "Couldn’t load this event" : "Event not found"}
          description={
            activity.isError
              ? "Check your connection and try again."
              : "This event or post isn’t available anymore."
          }
          action={
            activity.isError ? (
              <Button onClick={() => activity.refetch()}>Try again</Button>
            ) : (
              <Button nativeButton={false} render={<Link to="/explore" />}>
                Find other events
              </Button>
            )
          }
        />
      </div>
    );
  }

  const data = activity.data;
  const isEvent = data.kind === "event";
  const cancelled = data.status === "cancelled";
  const tile = activityDateTile(data);
  const time = activityTimeRange(data);
  const track = () => {
    if (isEvent && selectedNode) measurement.track("event", selectedNode, data.id);
  };

  return (
    <article className="flex flex-col gap-10">
      {back}
      <header className="flex flex-col gap-6">
        <div className="flex items-start gap-4 sm:gap-5">
          <DateTile activity={data} size="lg" />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{isEvent ? "Event" : "Update"}</Badge>
              {cancelled && <Badge variant="destructive">Cancelled</Badge>}
            </div>
            <h1
              className={cn(
                "text-3xl font-semibold wrap-anywhere text-foreground sm:text-4xl",
                cancelled && "line-through",
              )}
            >
              {data.title}
            </h1>
          </div>
        </div>
        <dl className="flex flex-col gap-3 text-base">
          {tile && (
            <div className="flex items-center gap-3">
              <dt className="sr-only">Date</dt>
              <ClockIcon className="size-5 shrink-0 text-muted-foreground" />
              <dd>
                {tile.full}
                {time && <span className="text-muted-foreground"> · {time}</span>}
              </dd>
            </div>
          )}
          {isEvent && data.venue && (
            <div className="flex items-center gap-3">
              <dt className="sr-only">Venue</dt>
              <MapPinIcon className="size-5 shrink-0 text-muted-foreground" />
              <dd className="min-w-0 wrap-anywhere">{data.venue}</dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-3">
          <Button
            nativeButton={false}
            render={(props) => (
              <a
                {...props}
                href={data.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={track}
                data-testid={`discovery-activity-outbound-${data.id}`}
              />
            )}
          >
            {isEvent ? (data.luma ? "Register on Luma" : "Event details") : "Read original post"}
            <ArrowUpRightIcon />
          </Button>
        </div>
      </header>

      {data.summary && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">About</h2>
          <p className="max-w-2xl whitespace-pre-line text-base text-muted-foreground">
            {data.summary}
          </p>
        </section>
      )}

      {host.data && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Hosted by</h2>
          <Link
            to="/n/$slug"
            params={{ slug: host.data.slug }}
            search={{ parentId: host.data.parentId ?? undefined }}
            data-testid="activity.host"
            className="group flex items-center gap-4 rounded-2xl border border-border p-4 transition-colors hover:bg-muted"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium text-foreground">{host.data.name}</span>
              <span className="truncate text-sm text-muted-foreground">
                {host.data.location || data.source}
              </span>
            </div>
            <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
      )}

      <footer className="border-t border-border pt-4">
        <ReportContent targetId={data.id} kind="activity" />
      </footer>
    </article>
  );
}
