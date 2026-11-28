import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { RouterContext } from "../context";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
});
