import { createFileRoute } from "@tanstack/react-router";
import { OrgMembersPage } from "@/components/org/members-page";

export const Route = createFileRoute("/_authenticated/admin/orgs/$orgId/members")({
  component: OrgMembersPage,
});
