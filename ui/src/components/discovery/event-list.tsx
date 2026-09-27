import { ArrowUpRightIcon, CaretRightIcon, ClockIcon, MapPinIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { ApiClient } from "@/app";
import { Badge } from "@/components/ui/badge";

export type PublicActivity = NonNullable<Awaited<ReturnType<ApiClient["getDiscoveryActivity"]>>>;

function clean(text: string) {
  return text.replace(/[  ]/g, " ");
}

function format(value: string, zone: string | undefined, options: Intl.DateTimeFormatOptions) {
  return clean(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options }).format(new Date(value)),
  );
}

export function activityDateTile(activity: PublicActivity) {
  const instant = activity.startsAt ?? activity.publishedAt;
  if (!instant) return null;
  const zone = activity.startsAt ? activity.timezone : "UTC";
  return {
    month: format(instant, zone, { month: "short" }),
    day: format(instant, zone, { day: "numeric" }),
    weekday: format(instant, zone, { weekday: "long" }),
    full: format(instant, zone, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
}

export function activityTimeRange(activity: PublicActivity) {
  if (!activity.startsAt) return null;
  const zone = activity.timezone;
  if (!activity.endsAt) {
    return format(activity.startsAt, zone, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }
  const start = format(activity.startsAt, zone, { hour: "numeric", minute: "2-digit" });
  const end = format(activity.endsAt, zone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${start} – ${end}`;
}

export function DateTile({
  activity,
  size = "default",
}: {
  activity: PublicActivity;
  size?: "default" | "lg";
}) {
  const tile = activityDateTile(activity);
  if (!tile) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-xl bg-muted text-foreground",
        size === "lg" ? "size-20" : "size-14",
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">{tile.month}</span>
      <span
        className={cn(
          "font-semibold tabular-nums leading-none",
          size === "lg" ? "text-3xl" : "text-xl",
        )}
      >
        {tile.day}
      </span>
    </div>
  );
}

export function EventList({
  events,
  nodeId,
  campaign,
  onOutbound,
  testId,
}: {
  events: PublicActivity[];
  nodeId?: string;
  campaign?: string;
  onOutbound?: (activity: PublicActivity) => void;
  testId?: string;
}) {
  return (
    <ul data-testid={testId} className="flex flex-col divide-y divide-border">
      {events.map((activity) => {
        const cancelled = activity.status === "cancelled";
        const time = activityTimeRange(activity);
        return (
          <li key={activity.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
            <DateTile activity={activity} />
            <div className={cn("flex min-w-0 flex-1 flex-col gap-1", cancelled && "opacity-60")}>
              <Link
                data-testid={`discovery-activity-detail-${activity.id}`}
                to="/activity/$activityId"
                params={{ activityId: activity.id }}
                search={{ node: nodeId, campaign }}
                className={cn(
                  "group flex items-center gap-1 font-medium text-foreground hover:underline",
                  cancelled && "line-through",
                )}
              >
                <span className="truncate">{activity.title}</span>
                <CaretRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {cancelled && <Badge variant="destructive">Cancelled</Badge>}
                {time && (
                  <span className="flex items-center gap-1.5">
                    <ClockIcon className="size-3.5 shrink-0" />
                    {time}
                  </span>
                )}
                {activity.kind === "event" && activity.venue && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPinIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{activity.venue}</span>
                  </span>
                )}
                {activity.kind === "social" && (
                  <a
                    data-testid={`discovery-activity-outbound-${activity.id}`}
                    href={activity.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onOutbound?.(activity)}
                    className="flex items-center gap-1 font-medium text-foreground hover:underline"
                  >
                    {activity.source || "Original post"}
                    <ArrowUpRightIcon className="size-3.5" />
                  </a>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
