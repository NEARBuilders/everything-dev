import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ title: "Auth Plugin (remote)" }],
  }),
  staticData: { nav: { label: "auth-root", order: 90 } },
  component: () => <Outlet />,
});
