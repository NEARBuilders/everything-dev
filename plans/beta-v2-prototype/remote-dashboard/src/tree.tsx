import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";

export function DashboardChrome() {
  return (
    <div style={{ border: "2px solid #f59e0b", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
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
    <div>
      <h1>Dashboard (/dashboard)</h1>
      <p>From remote-dashboard · grafted under host `public` mount</p>
      <a href="/dashboard/analytics">→ Analytics</a>
    </div>
  ),
});

const analyticsRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/dashboard/analytics",
  component: () => (
    <div>
      <h1>Analytics (/dashboard/analytics)</h1>
      <p>From remote-dashboard · grafted under host `public` mount</p>
      <a href="/dashboard">← Dashboard</a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  publicSubtreeRoot.addChildren([dashboardRoute, analyticsRoute]),
]);

export default { tree };
