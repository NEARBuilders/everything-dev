import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ActivityDetail } from "@/components/discovery/activity-detail";
import { PageContainer } from "@/components/layout/page-container";
import { pageTitle } from "@/lib/page-title";
export const Route = createFileRoute("/_public/activity/$activityId")({
  validateSearch: z.object({
    node: z.uuid().optional().catch(undefined),
    campaign: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_-]*$/)
      .optional()
      .catch(undefined),
  }),
  head: ({ match }) => ({ meta: [{ title: pageTitle("Event", match.context.runtimeConfig) }] }),
  component: ActivityPage,
});
function ActivityPage() {
  const { activityId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <PageContainer variant="narrow">
      <ActivityDetail activityId={activityId} {...search} />
    </PageContainer>
  );
}
