import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiClient } from "@/app";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function LumaImport({ nodeId }: { nodeId: string }) {
  const api = useApiClient();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const calendars = useQuery({
    queryKey: ["discovery-luma-calendars", nodeId],
    queryFn: () => api.listDiscoveryLumaCalendars({ nodeId }),
    retry: false,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const refresh = useMutation({
    mutationFn: (calendarId: string) => api.importDiscoveryLuma({ nodeId, calendarId }),
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("discovery"),
      }),
  });
  const disconnect = useMutation({
    mutationFn: () => api.disconnectDiscoveryLuma({ nodeId }),
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("discovery"),
      }),
  });
  const connection = calendars.data?.connection;
  const calendarItems = [
    ...(connection &&
    !calendars.data?.calendars.some((calendar) => calendar.id === connection.calendarId)
      ? [
          {
            label: `${connection.calendarName} · unavailable`,
            value: connection.calendarId,
          },
        ]
      : []),
    ...(calendars.data?.calendars ?? []).map((calendar) => ({
      label: calendar.name,
      value: calendar.id,
    })),
  ];
  return (
    <div className="flex flex-col gap-4">
      {calendars.isPending && <Skeleton className="h-11 w-full" />}
      {calendars.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load calendars. Try again in a moment.
        </p>
      )}
      {calendars.data?.unavailableCount ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Some calendars couldn't be loaded.
        </p>
      ) : null}
      {calendars.data?.calendars.length === 0 && !connection && (
        <p className="text-sm text-muted-foreground">
          No Luma calendars are set up for this site yet. Ask a site admin to add one.
        </p>
      )}
      {calendars.data && (calendars.data.calendars.length > 0 || connection) && (
        <Field>
          <FieldLabel htmlFor={`luma-calendar-${nodeId}`}>Calendar</FieldLabel>
          <Select
            items={calendarItems}
            value={connection?.calendarId ?? null}
            disabled={refresh.isPending || disconnect.isPending}
            onValueChange={(value) => {
              if (value) refresh.mutate(value);
            }}
          >
            <SelectTrigger
              id={`luma-calendar-${nodeId}`}
              data-testid="discovery-luma-calendar"
              className="w-full"
            >
              <SelectValue placeholder="Choose a calendar" />
            </SelectTrigger>
            <SelectContent>
              {calendarItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {connection && (
            <FieldDescription role="status">
              {refresh.isPending ? (
                "Loading events…"
              ) : (
                <>
                  Updated <LocalDate value={connection.syncedAt} format="relative" />
                  {connection.error ? " · last update failed" : ""}
                </>
              )}
            </FieldDescription>
          )}
        </Field>
      )}
      {!connection && refresh.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Connecting and loading events…
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't connect that calendar. Try again.
        </p>
      )}
      {disconnect.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't disconnect the calendar. Try again.
        </p>
      )}
      {connection && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          data-testid="discovery-luma-disconnect"
          disabled={disconnect.isPending}
          onClick={() => setConfirming(true)}
        >
          Disconnect calendar
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Disconnect Luma?"
        description="Luma events come off Explore. Events you added yourself stay."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        variant="destructive"
        isPending={disconnect.isPending}
        onConfirm={() => disconnect.mutate(undefined, { onSettled: () => setConfirming(false) })}
      />
    </div>
  );
}
