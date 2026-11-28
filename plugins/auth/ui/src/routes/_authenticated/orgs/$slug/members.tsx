import { createFileRoute } from "@tanstack/react-router";
import { OrgMembersPage } from "@/components/org/members-page";

export const Route = createFileRoute("/_authenticated/orgs/$slug/members")({
  component: OrgMembersPage,
});
