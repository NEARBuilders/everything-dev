import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_admin/_dashboard/admin/tenants")({
  component: () => <Outlet />,
});
