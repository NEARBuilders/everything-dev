import { createRootRoute, createRoute, Outlet, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";

interface DashboardApi {
  getStats: () => Promise<{ users: number; projects: number; revenue: number }>;
}

interface HostContext {
  apiClient?: { dashboard?: DashboardApi };
}

function TenantDashboardChrome() {
  return (
    <div style={{ border: "2px solid #f472b6", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#f472b6", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-tenant-dashboard-ui · TENANT override
      </div>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute();

const publicSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_public",
  component: TenantDashboardChrome,
});

function DashboardPage() {
  const { apiClient } = useRouteContext({ strict: false }) as HostContext;
  const [stats, setStats] = useState<{ users: number; projects: number; revenue: number } | null>(null);
  const apiOk = apiClient?.dashboard?.getStats ? "apiClient:ok" : "apiClient:missing";

  useEffect(() => {
    apiClient?.dashboard?.getStats().then(setStats);
  }, [apiClient]);

  return (
    <div data-testid="dashboard-tenant">
      <h1>Custom Dashboard (/dashboard) — TENANT UI</h1>
      <p>From remote-tenant-dashboard-ui · the tenant's OWN frontend for the SAME dashboard API.</p>
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

const revenueRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/dashboard/revenue",
  component: () => (
    <div>
      <h1>Revenue (/dashboard/revenue) — TENANT UI</h1>
      <p>A route that only exists in the tenant's dashboard frontend.</p>
      <a href="/dashboard">← Dashboard</a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  publicSubtreeRoot.addChildren([dashboardRoute, revenueRoute]),
]);

export default { tree };
