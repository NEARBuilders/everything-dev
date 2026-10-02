import { createFileRoute } from "@tanstack/react-router";
import {
  ActivityForm,
  ActivityFormPage,
  blankActivity,
} from "@/components/discovery/activity-form";
import { pageTitle } from "@/lib/page-title";

type NewActivitySearch = { kind?: "social" };

export const Route = createFileRoute("/_authenticated/_dashboard/nodes/$nodeId/events/new")({
  validateSearch: (search: Record<string, unknown>): NewActivitySearch =>
    search.kind === "social" ? { kind: "social" } : {},
  head: ({ match }) => ({
    meta: [
      {
        title: pageTitle(
          match.search.kind === "social" ? "New post" : "New event",
          match.context.runtimeConfig,
        ),
      },
    ],
  }),
  component: NewActivity,
});

function NewActivity() {
  const { nodeId } = Route.useParams();
  const { kind = "event" } = Route.useSearch();
  const isEvent = kind === "event";
  return (
    <ActivityFormPage
      nodeId={nodeId}
      title={isEvent ? "New event" : "New post"}
      description={
        isEvent ? "When, where, and how to join." : "Link to a post and add a short note."
      }
      headerTestId="activity-form.heading"
    >
      <ActivityForm key={kind} nodeId={nodeId} initial={blankActivity(nodeId, kind)} />
    </ActivityFormPage>
  );
}
