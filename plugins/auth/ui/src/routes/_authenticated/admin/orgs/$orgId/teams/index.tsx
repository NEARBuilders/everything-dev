import { createFileRoute } from "@tanstack/react-router";
import { OrgTeamsPage } from "@/components/org/teams-page";

export const Route = createFileRoute("/_authenticated/admin/orgs/$orgId/teams/")({
  component: OrgTeamsPage,
});
