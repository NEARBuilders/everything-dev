import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: () => (
    <div data-plugin="landing" data-area="public">
      [landing:public] <Outlet />
    </div>
  ),
});
