import { createFileRoute } from "@tanstack/react-router";
import { OrgOverviewPage } from "@/components/org/overview-page";

export const Route = createFileRoute("/_authenticated/admin/orgs/$orgId/")({
  component: OrgOverviewPage,
});
