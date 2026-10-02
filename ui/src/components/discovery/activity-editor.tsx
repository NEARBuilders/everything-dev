import {
  ArrowsClockwiseIcon,
  ArrowUpRightIcon,
  CalendarDotsIcon,
  ChatCircleIcon,
  ClockIcon,
  DotsThreeIcon,
  MapPinIcon,
  QrCodeIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useState } from "react";
import { useApiClient } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClientValue } from "@/hooks";
import { buildEventTimeline } from "@/lib/event-timeline";
import { type Activity, activitiesQueryOptions } from "./activity-form";
import { useStartOnboarding } from "./event-onboarding";
import { EventTimeline } from "./event-timeline";
import { LumaImport } from "./luma-import";
import { ReportContent } from "./report-content";

export function ActivityEditor({ nodeId }: { nodeId: string }) {
  const api = useApiClient();
  const [lumaOpen, setLumaOpen] = useState(false);
  const list = useQuery({ ...activitiesQueryOptions(api, nodeId), refetchInterval: 30_000 });
  const luma = useQuery({
    queryKey: ["discovery-luma-calendars", nodeId],
    queryFn: () => api.listDiscoveryLumaCalendars({ nodeId }),
    retry: false,
    staleTime: 60_000,
  });
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const viewerTimeZone = useClientValue(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    "UTC",
  );
  const startOnboarding = useStartOnboarding();
  if (list.isError)
    return (
      <EmptyState
        icon={CalendarDotsIcon}
        title="Couldn't load events"
        description="Check your connection and try again."
        action={
          <Button variant="outline" onClick={() => list.refetch()}>
            Try again
          </Button>
        }
      />
    );
  const events = list.data?.filter((a) => a.kind === "event") ?? [];
  const posts = list.data?.filter((a) => a.kind !== "event") ?? [];
  const timeline =
    events.length > 0
      ? buildEventTimeline(events, { now: new Date(), timeZone: viewerTimeZone })
      : null;
  const rowActions = (a: Activity) => (
    <div className="flex items-center gap-1">
      {a.luma ? (
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={(props) => (
            <a {...props} href={a.url} target="_blank" rel="noopener noreferrer" />
          )}
        >
          Edit in Luma
          <ArrowUpRightIcon />
        </Button>
      ) : (
        <Button
          data-testid={`discovery-edit-activity-${a.id}`}
          variant="ghost"
          size="sm"
          aria-label={`Edit ${a.title}`}
          nativeButton={false}
          render={
            <Link
              to="/nodes/$nodeId/events/$activityId/edit"
              params={{ nodeId, activityId: a.id }}
            />
          }
        >
          Edit
        </Button>
      )}
      {a.kind === "event" && a.status !== "cancelled" && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${a.title}`} />}
          >
            <DotsThreeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              data-testid={`activity-editor.start-onboarding-${a.id}`}
              disabled={startOnboarding.isPending}
              onClick={() => startOnboarding.mutate({ eventId: a.id })}
            >
              <QrCodeIcon />
              Start onboarding
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  const connection = luma.data?.connection;
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="discovery-new-event"
            nativeButton={false}
            render={<Link to="/nodes/$nodeId/events/new" params={{ nodeId }} />}
          >
            <CalendarDotsIcon /> Add event
          </Button>
          <Button
            data-testid="discovery-new-social"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/nodes/$nodeId/events/new"
                params={{ nodeId }}
                search={{ kind: "social" }}
              />
            }
          >
            <ChatCircleIcon /> Share a post
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="max-w-full self-start sm:self-auto"
          data-testid="activity-editor.luma-open"
          onClick={() => setLumaOpen(true)}
        >
          <ArrowsClockwiseIcon />
          <span className="truncate">
            {connection ? `Luma · ${connection.calendarName}` : "Import from Luma"}
          </span>
          {connection?.error && <Badge variant="destructive">Sync failed</Badge>}
        </Button>
      </div>
      {list.isPending && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-48" />
          {["a", "b", "c"].map((key) => (
            <Skeleton key={key} className="h-20 w-full" />
          ))}
        </div>
      )}
      {list.data?.length === 0 && (
        <EmptyState
          icon={CalendarDotsIcon}
          title="No events yet"
          description="Add your first meetup or share a post so people know what's on."
        />
      )}
      {timeline && (
        <Tabs
          value={when}
          onValueChange={(value) => setWhen(value === "past" ? "past" : "upcoming")}
        >
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line">
              <TabsTrigger value="upcoming" data-testid="activity-editor.tab-upcoming">
                Upcoming
                <Badge variant="secondary">{timeline.upcomingCount}</Badge>
              </TabsTrigger>
              <TabsTrigger value="past" data-testid="activity-editor.tab-past">
                Past
                <Badge variant="secondary">{timeline.pastCount}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>
          {(["upcoming", "past"] as const).map((tab) => (
            <TabsContent key={tab} value={tab} className="pt-6">
              {timeline[tab].length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  {tab === "upcoming" ? "Nothing scheduled." : "No past events yet."}
                </p>
              ) : (
                <EventTimeline
                  groups={timeline[tab]}
                  timeZone={viewerTimeZone}
                  badges={(a) => (
                    <>
                      <Badge variant={statusVariant(a)}>{statusLabel(a)}</Badge>
                      {a.luma && <Badge variant="outline">Luma</Badge>}
                    </>
                  )}
                  actions={rowActions}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
      {posts.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-medium">Posts</h3>
          <ItemGroup>
            {posts.map((a) => (
              <Item key={a.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    <span className="min-w-0 truncate">{a.title}</span>
                    <Badge variant={statusVariant(a)}>{statusLabel(a)}</Badge>
                  </ItemTitle>
                  <ItemDescription>
                    <LocalDate value={a.publishedAt} format="relative" />
                  </ItemDescription>
                </ItemContent>
                <ItemActions>{rowActions(a)}</ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </div>
      )}
      <Dialog open={lumaOpen} onOpenChange={setLumaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from Luma</DialogTitle>
            <DialogDescription>
              Public events from a Luma calendar appear here and stay in sync.
            </DialogDescription>
          </DialogHeader>
          <LumaImport nodeId={nodeId} />
        </DialogContent>
      </Dialog>
    </section>
  );
}
function statusVariant(activity: Activity) {
  if (activity.status === "published") return "success" as const;
  if (activity.status === "cancelled") return "destructive" as const;
  return "secondary" as const;
}
function statusLabel(activity: Activity) {
  if (activity.status === "draft") return "Draft";
  if (activity.status === "cancelled") return "Cancelled";
  return "Published";
}
function eventDateKey(activity: Activity) {
  if (!activity.startsAt) return "undated";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: activity.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(activity.startsAt));
}
function eventDateLabel(activity: Activity) {
  if (!activity.startsAt) return "Date to be announced";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: activity.timezone,
    month: "short",
    day: "numeric",
    weekday: "long",
  }).formatToParts(new Date(activity.startsAt));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")} ${value("day")} ${value("weekday")}`;
}
function eventTimeRange(activity: Activity) {
  if (!activity.startsAt) return null;
  const start = new Intl.DateTimeFormat(undefined, {
    timeZone: activity.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(activity.startsAt));
  if (!activity.endsAt) return start;
  const end = new Intl.DateTimeFormat(undefined, {
    timeZone: activity.timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(activity.endsAt));
  return `${start} – ${end}`;
}
function eventDateTile(activity: Activity) {
  const instant = activity.startsAt ?? activity.publishedAt;
  if (!instant) return null;
  const date = new Date(instant);
  const zone = activity.startsAt ? activity.timezone : undefined;
  return {
    month: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short" }).format(date),
    day: new Intl.DateTimeFormat("en-US", { timeZone: zone, day: "numeric" }).format(date),
  };
}
export function EventCalendar({
  events,
  nodeId,
  campaign,
  onOutbound,
}: {
  events: Activity[];
  nodeId?: string;
  campaign?: string;
  onOutbound?: (activity: Activity) => void;
}) {
  const groups: { key: string; label: string; events: Activity[] }[] = [];
  for (const activity of events) {
    const key = eventDateKey(activity);
    const current = groups.find((group) => group.key === key);
    if (current) current.events.push(activity);
    else groups.push({ key, label: eventDateLabel(activity), events: [activity] });
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" />
            {group.label}
          </h3>
          <div className="flex flex-col overflow-hidden rounded-xl bg-muted/50">
            {group.events.map((activity) => (
              <ActivityCard
                key={activity.id}
                activity={activity}
                nodeId={nodeId}
                campaign={campaign}
                onOutbound={onOutbound ? () => onOutbound(activity) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
export function ActivityCard({
  activity,
  onOutbound,
  nodeId,
  campaign,
  variant = "list",
}: {
  activity: Activity;
  onOutbound?: () => void;
  nodeId?: string;
  campaign?: string;
  variant?: "list" | "detail";
}) {
  const tile = eventDateTile(activity);
  const time = useClientValue(() => eventTimeRange(activity), null);
  const cancelled = activity.status === "cancelled";
  return (
    <article className="flex flex-col gap-4">
      <div className={cn("flex items-center gap-4 px-4 py-3.5", cancelled && "opacity-60")}>
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-medium leading-snug wrap-anywhere", cancelled && "line-through")}>
            <Link
              data-testid={`discovery-activity-detail-${activity.id}`}
              to="/activity/$activityId"
              params={{ activityId: activity.id }}
              search={{ node: nodeId, campaign }}
            >
              {activity.title}
            </Link>
          </h3>
          {cancelled && <p className="mt-1 text-xs font-medium">Cancelled</p>}
          {time && (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <ClockIcon className="size-3.5 shrink-0" />
              {time}
            </p>
          )}
          {activity.kind === "event" && activity.venue && (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPinIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 wrap-anywhere">{activity.venue}</span>
            </p>
          )}
          {activity.kind === "social" && (
            <a
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium"
              data-testid={`discovery-activity-outbound-${activity.id}`}
              href={activity.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onOutbound}
            >
              Read original post
              <ArrowUpRightIcon className="size-3.5" />
            </a>
          )}
        </div>
        {tile && activity.kind === "event" && (
          <a
            className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg bg-background text-foreground"
            data-testid={`discovery-activity-outbound-${activity.id}`}
            href={activity.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOutbound}
            aria-label="Event details"
          >
            <span className="text-sm font-medium text-muted-foreground">{tile.month}</span>
            <span className="text-xl font-semibold tabular-nums leading-none">{tile.day}</span>
          </a>
        )}
        {tile && activity.kind === "social" && (
          <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg bg-background text-foreground">
            <span className="text-sm font-medium text-muted-foreground">{tile.month}</span>
            <span className="text-xl font-semibold tabular-nums leading-none">{tile.day}</span>
          </div>
        )}
      </div>
      {variant === "detail" && (
        <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-4">
          {activity.summary && (
            <p className="text-sm leading-relaxed text-muted-foreground">{activity.summary}</p>
          )}
          {activity.luma && (
            <p className="text-sm text-muted-foreground">Details and registration are on Luma.</p>
          )}
          <ReportContent targetId={activity.id} kind="activity" />
        </div>
      )}
    </article>
  );
}
