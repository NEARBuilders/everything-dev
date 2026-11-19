import { createFileRoute } from "@tanstack/react-router";
import { OrgTeamsPage } from "@/components/org/teams-page";

export const Route = createFileRoute("/_authenticated/orgs/$slug/teams/")({
  component: OrgTeamsPage,
});
