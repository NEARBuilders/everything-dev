import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: () => (
    <div data-plugin="auth" data-area="public">
      [auth:public] <Outlet />
    </div>
  ),
});
