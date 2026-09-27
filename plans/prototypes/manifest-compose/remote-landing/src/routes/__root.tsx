import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ title: "Landing (remote)" }],
  }),
  component: () => <Outlet />,
});
