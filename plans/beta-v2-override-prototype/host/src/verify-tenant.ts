import {
  importUiTree,
  importDashboardApi,
  buildApiClient,
  match,
  renderRoute,
  makeContext,
  runChecks,
  composeApp,
} from "./verify-helpers";

/**
 * TENANT configuration — the override case. Same dashboard API, swapped
 * dashboard UI (remote-tenant-dashboard-ui), landing inherited unchanged.
 */
async function main() {
  const [dashboardApi, tenantDashboardUi, landing] = await Promise.all([
    importDashboardApi(),
    importUiTree("tenant-dashboard-ui", "dashboard"),
    importUiTree("landing", "landing"),
  ]);
  const apiClient = buildApiClient(dashboardApi);

  const composed = composeApp([tenantDashboardUi, landing]);
  const ctx = makeContext(apiClient);

  const dash = await match(composed.routeTree, "/dashboard");
  const revenue = await match(composed.routeTree, "/dashboard/revenue");
  const home = await match(composed.routeTree, "/");
  const dashHtml = await renderRoute(composed.routeTree, "/dashboard", ctx);
  const revenueHtml = await renderRoute(composed.routeTree, "/dashboard/revenue", ctx);
  const homeHtml = await renderRoute(composed.routeTree, "/", ctx);
  const stats = await dashboardApi.getStats();

  runChecks("TENANT CONFIG — swapped dashboard UI, shared dashboard API", [
    [composed.mountCounts.public === 2, `mountCounts.public === 2 (got ${composed.mountCounts.public})`],
    [dash.leaf.includes("dashboard__public"), `GET /dashboard → leaf "${dash.leaf}" (same namespaced id as base)`],
    [dash.branch.includes("/public") && dash.branch.indexOf("/public") < dash.branch.indexOf(dash.leaf),
      `host mount /public precedes dashboard leaf in branch (${dash.branch.join(" → ")})`],
    [revenue.leaf.includes("dashboard__public"), `GET /dashboard/revenue matches (tenant-only route exists): "${revenue.leaf}"`],
    [dashHtml.includes('data-testid="dashboard-tenant"'), "dashboard renders TENANT UI marker"],
    [!dashHtml.includes("dashboard-base"), "dashboard does NOT render base marker (override won)"],
    [revenueHtml.includes("TENANT UI"), "tenant-only /dashboard/revenue route renders"],
    [dashHtml.includes("apiClient:ok"), "apiClient injected into tenant dashboard component"],
    [homeHtml.includes('data-testid="landing-home"') && homeHtml.includes("apiClient:ok"),
      "landing inherited unchanged + apiClient injected"],
    [stats.users === 42 && stats.projects === 7, `shared apiClient.dashboard.getStats() → ${stats.users} users / ${stats.projects} projects`],
  ]);
}

main().catch((err) => {
  console.error("verify-tenant crashed:", err);
  process.exit(1);
});
