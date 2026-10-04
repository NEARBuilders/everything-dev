import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  loader: ({ context }) => ({ who: context.user?.name ?? "anonymous" }),
  component: () => (
    <div>
      [auth:settings-layout] <Outlet />
    </div>
  ),
});
