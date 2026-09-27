import { DotsThreeIcon, QrCodeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { type ApiClient, useApiClient } from "@/app";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { useClientValue } from "@/hooks";
import { formatRemaining, onboardingCodeState } from "@/lib/onboarding-codes";

export type DiscoveryActivity = Awaited<ReturnType<ApiClient["listDiscoveryActivities"]>>[number];
type OnboardingCode = Awaited<ReturnType<ApiClient["auth"]["listOnboardingCodes"]>>[number];

export function upcomingEvents(activities: readonly DiscoveryActivity[], now: number) {
  return activities
    .filter((activity) => activity.kind === "event" && activity.status !== "cancelled")
    .filter((activity) => {
      const boundary = activity.endsAt ?? activity.startsAt;
      return !boundary || Date.parse(boundary) >= now;
    })
    .sort(
      (a, b) =>
        (a.startsAt ? Date.parse(a.startsAt) : Number.POSITIVE_INFINITY) -
        (b.startsAt ? Date.parse(b.startsAt) : Number.POSITIVE_INFINITY),
    );
}

export function parseMaxJoins(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : undefined;
}

export function useStartOnboarding(organizationId?: string | null) {
  const api = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  return useMutation({
    mutationFn: ({ eventId, maxUses }: { eventId: string; maxUses?: number }) =>
      api.createEventOnboardingCode({ eventId, ...(maxUses ? { maxUses } : {}) }),
    onSuccess: (code) =>
      navigate({
        to: "/onboarding/station/$codeId",
        params: { codeId: code.id },
        search: { org: organizationId ?? undefined, from: location.href },
      }),
    onError: (error: Error) =>
      toast.error(error.message || "Couldn't start onboarding for this event."),
  });
}

export function EventDate({ value, timeZone }: { value: string | null; timeZone?: string }) {
  const label = useClientValue(() => {
    if (!value) return "";
    const date = new Date(value);
    const month = new Intl.DateTimeFormat(undefined, { month: "short", timeZone }).format(date);
    const day = new Intl.DateTimeFormat(undefined, { day: "numeric", timeZone }).format(date);
    return `${month}|${day}`;
  }, "");
  const [month, day] = label ? label.split("|") : [];
  return (
    <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-muted">
      {label ? (
        <>
          <span className="text-xs font-medium text-muted-foreground">{month}</span>
          <span className="text-lg font-semibold leading-none tabular-nums">{day}</span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">{value ? "" : "TBA"}</span>
      )}
    </div>
  );
}

function StationRow({
  code,
  organizationId,
  primary,
  onRevoke,
}: {
  code: OnboardingCode;
  organizationId: string;
  primary: boolean;
  onRevoke: () => void;
}) {
  const location = useLocation();
  return (
    <Item variant="outline" data-testid={`community-onboarding.station-${code.id}`}>
      <ItemMedia variant="icon">
        <QrCodeIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{code.eventName}</ItemTitle>
        <ItemDescription>
          {code.usedCount} of {code.maxUses} joined · {formatRemaining(code.expiresAt)} left
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          size="sm"
          variant={primary ? "default" : "outline"}
          nativeButton={false}
          render={
            <Link
              to="/onboarding/station/$codeId"
              params={{ codeId: code.id }}
              search={{ org: organizationId, from: location.href }}
            />
          }
          data-testid={`community-onboarding.open-station-${code.id}`}
        >
          Open station
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${code.eventName}`} />
            }
          >
            <DotsThreeIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={onRevoke}>
              Close station
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

export function EventOnboardingPanel({
  nodeId,
  organizationId,
}: {
  nodeId: string;
  organizationId: string | null;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [maxJoins, setMaxJoins] = useState("");
  const [revoking, setRevoking] = useState<OnboardingCode | null>(null);
  const [now] = useState(() => Date.now());
  const start = useStartOnboarding(organizationId);
  const activities = useQuery({
    queryKey: ["discovery-activities", nodeId],
    queryFn: () => api.listDiscoveryActivities({ nodeId }),
    retry: false,
  });
  const codesKey = ["community-onboarding-codes", organizationId] as const;
  const codes = useQuery({
    queryKey: codesKey,
    queryFn: () => api.auth.listOnboardingCodes({ organizationId: organizationId ?? "" }),
    enabled: !!organizationId,
    retry: false,
    refetchInterval: 10_000,
  });
  const revoke = useMutation({
    mutationFn: (codeId: string) =>
      api.auth.revokeOnboardingCode({ codeId, organizationId: organizationId ?? "" }),
    onSuccess: () => {
      toast.success("Station closed");
      setRevoking(null);
      return queryClient.invalidateQueries({ queryKey: codesKey });
    },
    onError: (error: Error) => toast.error(error.message || "Couldn't close the station."),
  });

  const events = upcomingEvents(activities.data ?? [], now);
  const nodeEventIds = new Set((activities.data ?? []).map((activity) => activity.id));
  const live = (codes.data ?? []).filter(
    (code) =>
      onboardingCodeState(code) === "active" && (!code.eventId || nodeEventIds.has(code.eventId)),
  );

  return (
    <div className="flex flex-col gap-12">
      {live.length > 0 && (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Live stations" />
          <ItemGroup>
            {live.map((code, index) => (
              <StationRow
                key={code.id}
                code={code}
                organizationId={organizationId ?? ""}
                primary={index === 0}
                onRevoke={() => setRevoking(code)}
              />
            ))}
          </ItemGroup>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Upcoming events"
          description="Start a station and attendees join your organization by scanning its QR."
          action={
            events.length > 0 ? (
              <Field orientation="horizontal" className="w-auto">
                <FieldLabel htmlFor="discovery-onboarding-max-joins">Max joins</FieldLabel>
                <Input
                  id="discovery-onboarding-max-joins"
                  data-testid="discovery-onboarding-max-joins"
                  className="w-20"
                  inputMode="numeric"
                  placeholder="50"
                  value={maxJoins}
                  onChange={(event) => setMaxJoins(event.target.value)}
                />
              </Field>
            ) : null
          }
        />
        {activities.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : activities.isError ? (
          <p role="alert" className="text-sm text-muted-foreground">
            Couldn't load events. Only this community's owners can run onboarding.
          </p>
        ) : events.length === 0 ? (
          <EmptyState
            icon={QrCodeIcon}
            title="No upcoming events"
            description="Add an event first, then start onboarding from here."
            action={
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/nodes/$nodeId/content"
                    params={{ nodeId }}
                    search={{ tab: "events" }}
                  />
                }
              >
                Add an event
              </Button>
            }
          />
        ) : (
          <ItemGroup>
            {events.map((event, index) => (
              <Item key={event.id} variant="outline">
                <ItemMedia>
                  <EventDate value={event.startsAt} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    <span className="min-w-0 truncate">{event.title}</span>
                    {event.status === "draft" && <Badge variant="secondary">Draft</Badge>}
                  </ItemTitle>
                  <ItemDescription>
                    {event.startsAt ? <LocalDate value={event.startsAt} format="datetime" /> : null}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant={index === 0 && live.length === 0 ? "default" : "outline"}
                    data-testid={`discovery-start-onboarding-${event.id}`}
                    disabled={start.isPending}
                    onClick={() =>
                      start.mutate({ eventId: event.id, maxUses: parseMaxJoins(maxJoins) })
                    }
                  >
                    <QrCodeIcon />
                    Start onboarding
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        {start.isError && (
          <p
            role="alert"
            className="text-sm text-destructive"
            data-testid="discovery-start-onboarding-error"
          >
            {start.error.message || "Couldn't start onboarding for this event."}
          </p>
        )}
      </section>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title="Close this station?"
        description="Its QR code stops working. People who already joined stay members."
        confirmLabel="Close station"
        cancelLabel="Keep open"
        variant="destructive"
        isPending={revoke.isPending}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id);
        }}
      />
    </div>
  );
}
