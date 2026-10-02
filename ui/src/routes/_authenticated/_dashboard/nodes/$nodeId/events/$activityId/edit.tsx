import { CalendarDotsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApiClient } from "@/app";
import {
  ActivityForm,
  ActivityFormPage,
  activitiesQueryOptions,
} from "@/components/discovery/activity-form";
import { EmptyState } from "@/components/empty-state";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/nodes/$nodeId/events/$activityId/edit",
)({
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Edit event", match.context.runtimeConfig) }],
  }),
  component: EditActivity,
});

function EditActivity() {
  const { nodeId, activityId } = Route.useParams();
  const api = useApiClient();
  const list = useQuery(activitiesQueryOptions(api, nodeId));
  const activity = list.data?.find((item) => item.id === activityId);

  if (list.isPending) {
    return (
      <ActivityFormPage
        nodeId={nodeId}
        title={<Skeleton className="h-10 w-full max-w-64" />}
        headerTestId="activity-form.heading"
      >
        <div className="flex flex-col gap-6" aria-busy="true">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-11 w-full" />
          ))}
        </div>
      </ActivityFormPage>
    );
  }

  if (!activity) {
    return (
      <ActivityFormPage nodeId={nodeId} title="Edit event" headerTestId="activity-form.heading">
        <EmptyState
          icon={CalendarDotsIcon}
          title={list.isError ? "Couldn't load this event" : "Event not found"}
          description={
            list.isError ? "Check your connection and try again." : "It may have been removed."
          }
          action={
            list.isError ? (
              <Button variant="outline" onClick={() => list.refetch()}>
                Try again
              </Button>
            ) : (
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <Link
                    to="/nodes/$nodeId/content"
                    params={{ nodeId }}
                    search={{ tab: "events" }}
                  />
                }
              >
                Back to events
              </Button>
            )
          }
        />
      </ActivityFormPage>
    );
  }

  const imported = activity.luma;
  const isEvent = activity.kind === "event";
  return (
    <ActivityFormPage
      nodeId={nodeId}
      title={isEvent ? "Edit event" : "Edit post"}
      description={
        imported ? (
          <>
            Synced from Luma <LocalDate value={imported.syncedAt} format="relative" />. Edit details
            on Luma.
            {!imported.available && " This event is no longer public there."}
          </>
        ) : isEvent ? (
          "When, where, and how to join."
        ) : (
          "Link to a post and add a short note."
        )
      }
      headerTestId="activity-form.heading"
    >
      <ActivityForm key={activity.id} nodeId={nodeId} initial={activity} imported={imported} />
    </ActivityFormPage>
  );
}
