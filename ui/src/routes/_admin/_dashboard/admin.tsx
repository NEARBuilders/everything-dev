import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PageContainer } from "@/components";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_admin/_dashboard/admin")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Admin", match.context.runtimeConfig) }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <PageContainer variant="wide">
      <Outlet />
    </PageContainer>
  );
}
