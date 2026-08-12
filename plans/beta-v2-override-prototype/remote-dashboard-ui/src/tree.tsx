import { createRootRoute, createRoute, Outlet, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";

interface DashboardApi {
  getStats: () => Promise<{ users: number; projects: number; revenue: number }>;
}

interface HostContext {
  apiClient?: { dashboard?: DashboardApi };
}

function DashboardChrome() {
  return (
    <div style={{ border: "2px solid #f59e0b", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-dashboard-ui · base
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

function DashboardPage() {
  const { apiClient } = useRouteContext({ strict: false }) as HostContext;
  const [stats, setStats] = useState<{ users: number; projects: number; revenue: number } | null>(null);
  const apiOk = apiClient?.dashboard?.getStats ? "apiClient:ok" : "apiClient:missing";

  useEffect(() => {
    apiClient?.dashboard?.getStats().then(setStats);
  }, [apiClient]);

  return (
    <div data-testid="dashboard-base">
      <h1>Dashboard (/dashboard) — BASE UI</h1>
      <p>From remote-dashboard-ui · the DEFAULT dashboard frontend.</p>
      <p>
        stats: {stats ? `${stats.users} users · ${stats.projects} projects · $${stats.revenue}` : "loading…"}
      </p>
      <span data-testid="api-client-status" style={{ display: "none" }}>
        {apiOk}
      </span>
    </div>
  );
}

const dashboardRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/dashboard",
  component: DashboardPage,
});

const analyticsRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/dashboard/analytics",
  component: () => (
    <div>
      <h1>Analytics (/dashboard/analytics) — BASE UI</h1>
      <p>From remote-dashboard-ui · grafted under host `public` mount.</p>
      <a href="/dashboard">← Dashboard</a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  publicSubtreeRoot.addChildren([dashboardRoute, analyticsRoute]),
]);

export default { tree };
