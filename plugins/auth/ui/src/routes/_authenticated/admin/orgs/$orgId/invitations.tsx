import { createFileRoute } from "@tanstack/react-router";
import { OrgInvitationsPage } from "@/components/org/invitations-page";

export const Route = createFileRoute("/_authenticated/admin/orgs/$orgId/invitations")({
  component: OrgInvitationsPage,
});
