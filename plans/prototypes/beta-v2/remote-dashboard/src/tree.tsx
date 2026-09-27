import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
// CSS is imported by tree.with-css.ts (browser/MF builds) — NOT here
// (so the verify script can import this file directly without a CSS loader)

export function DashboardChrome() {
  return (
    <div className="border-2 border-dashboard rounded-lg p-3">
      <div className="text-xs text-dashboard uppercase tracking-wider font-bold">
        remote-dashboard
      </div>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute();

const publicSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_public",
  component: DashboardChrome,
});

const dashboardRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/dashboard",
  component: () => (
    <div className="p-4">
      <h1 className="text-xl font-bold text-foreground">Dashboard (/dashboard)</h1>
      <p className="text-muted-foreground mt-2">
        From remote-dashboard · grafted under host `public` mount
      </p>
      <a href="/dashboard/analytics" className="text-dashboard underline mt-4 inline-block">
        → Analytics
      </a>
    </div>
  ),
});

const analyticsRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/dashboard/analytics",
  component: () => (
    <div className="p-4">
      <h1 className="text-xl font-bold text-foreground">Analytics (/dashboard/analytics)</h1>
      <p className="text-muted-foreground mt-2">
        From remote-dashboard · grafted under host `public` mount
      </p>
      <a href="/dashboard" className="text-dashboard underline mt-4 inline-block">
        ← Dashboard
      </a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  publicSubtreeRoot.addChildren([dashboardRoute, analyticsRoute]),
]);

export default { tree };
