import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  component: () => (
    <div data-plugin="auth" data-area="authenticated">
      [auth:authenticated] <Outlet />
    </div>
  ),
});
