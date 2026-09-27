import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: () => (
    <div data-plugin="landing-tenant" data-area="public">
      [landing-tenant:public] <Outlet />
    </div>
  ),
});
