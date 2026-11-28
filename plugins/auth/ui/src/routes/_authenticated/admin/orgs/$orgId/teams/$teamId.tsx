import { createFileRoute } from "@tanstack/react-router";
import { OrgTeamDetailPage } from "@/components/org/team-detail-page";

export const Route = createFileRoute("/_authenticated/admin/orgs/$orgId/teams/$teamId")({
  component: TeamDetail,
});

function TeamDetail() {
  const { teamId } = Route.useParams();
  return <OrgTeamDetailPage teamId={teamId} />;
}
