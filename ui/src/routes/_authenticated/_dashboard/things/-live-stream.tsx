import { BroadcastIcon } from "@phosphor-icons/react";
import { Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiClient } from "@/app";
import { Badge, Button, EmptyState, LocalDate, PageContainer, PageHeader } from "@/components";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { ThingBackLink } from "./-thing-details-view";

type ApiClient = ReturnType<typeof useApiClient>;
type ThingEvent =
  Awaited<ReturnType<ApiClient["template"]["subscribeThings"]>> extends AsyncIterable<infer Event>
    ? Event
    : never;
type LiveThingEvent = { receiptId: number; event: ThingEvent };

function actionVariant(action: string) {
  if (action === "created") return "success" as const;
  if (action === "deleted") return "destructive" as const;
  return "secondary" as const;
}

export function ThingsLiveStreamPage() {
  const apiClient = useApiClient();
  const router = useRouter();
  const canGoBack = router.history.canGoBack?.() ?? false;
  const nextReceiptId = useRef(0);
  const [events, setEvents] = useState<LiveThingEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setConnectionError(null);

    void (async () => {
      try {
        const stream = await apiClient.template.subscribeThings({}, { signal: abort.signal });
        if (abort.signal.aborted) return;
        setConnected(true);
        for await (const event of stream) {
          if (abort.signal.aborted) break;
          const receiptId = nextReceiptId.current++;
          setEvents((previous) => [{ receiptId, event }, ...previous].slice(0, 200));
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setConnectionError(error instanceof Error ? error.message : "The event stream ended.");
        }
      } finally {
        if (!abort.signal.aborted) setConnected(false);
      }
    })();

    return () => abort.abort();
  }, [apiClient, attempt]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return (
    <PageContainer variant="default">
      <div className="flex flex-col gap-4">
        <ThingBackLink canGoBack={canGoBack} onBack={() => router.history.back()} />
        <PageHeader
          title="Live stream"
          description="Things as they are created and deleted."
          headerTestId="things.live.heading"
          actions={
            <>
              <Badge
                variant={connected ? "success" : connectionError ? "destructive" : "secondary"}
                title={connected ? "Connected" : "Disconnected"}
                className="self-center"
                data-testid="things-live-status"
              >
                {connected ? "Live" : connectionError ? "Disconnected" : "Connecting"}
              </Badge>
              <Button
                type="button"
                variant="outline"
                onClick={clearEvents}
                disabled={events.length === 0}
                data-testid="things-live-clear"
              >
                Clear ({events.length})
              </Button>
            </>
          }
        />
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={BroadcastIcon}
          title={
            connectionError
              ? "Stream disconnected"
              : connected
                ? "Waiting for events"
                : "Connecting"
          }
          description={
            connectionError ?? (connected ? "New things appear here the moment they change." : "")
          }
          action={
            connectionError ? (
              <Button
                variant="outline"
                onClick={() => setAttempt((value) => value + 1)}
                data-testid="things-live-reconnect"
              >
                Reconnect
              </Button>
            ) : connected ? undefined : (
              <Spinner />
            )
          }
        />
      ) : (
        <ItemGroup data-testid="things-live-events">
          {events.map(({ receiptId, event }) => (
            <Item key={receiptId} variant="outline" size="sm" role="listitem">
              <ItemContent className="min-w-0">
                <ItemTitle className="max-w-full">
                  <Badge variant={actionVariant(event.action)}>{event.action}</Badge>
                  <Link
                    to="/things/$thingId"
                    params={{ thingId: event.thingId }}
                    className="truncate font-mono text-foreground underline-offset-4 hover:underline"
                  >
                    {event.thingId}
                  </Link>
                </ItemTitle>
                <ItemDescription>
                  <span className="font-mono">{event.type}</span>
                  <span aria-hidden="true"> · </span>
                  <LocalDate value={event.timestamp} format="time" />
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
    </PageContainer>
  );
}
