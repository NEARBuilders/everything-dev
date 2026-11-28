import { createFileRoute } from "@tanstack/react-router";
import { OrgInvitationsPage } from "@/components/org/invitations-page";

export const Route = createFileRoute("/_authenticated/orgs/$slug/invitations")({
  component: OrgInvitationsPage,
});
