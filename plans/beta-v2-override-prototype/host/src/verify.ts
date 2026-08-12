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
 * BASE configuration. Proves the base app composes: dashboard uses its DEFAULT
 * UI (remote-dashboard-ui), landing is a UI-only plugin, and the host-injected
 * apiClient reaches every federated component.
 */
async function main() {
  const [dashboardApi, dashboardUi, landing] = await Promise.all([
    importDashboardApi(),
    importUiTree("dashboard-ui", "dashboard"),
    importUiTree("landing", "landing"),
  ]);
  const apiClient = buildApiClient(dashboardApi);

  const composed = composeApp([dashboardUi, landing]);
  const ctx = makeContext(apiClient);

  const dash = await match(composed.routeTree, "/dashboard");
  const home = await match(composed.routeTree, "/");
  const dashHtml = await renderRoute(composed.routeTree, "/dashboard", ctx);
  const homeHtml = await renderRoute(composed.routeTree, "/", ctx);
  const stats = await dashboardApi.getStats();

  runChecks("BASE CONFIG — dashboard default UI + apiClient injection", [
    [composed.mountCounts.public === 2, `mountCounts.public === 2 (got ${composed.mountCounts.public})`],
    [dash.leaf.includes("dashboard__public"), `GET /dashboard → leaf "${dash.leaf}" (namespaced id)`],
    [dash.branch.includes("/public") && dash.branch.indexOf("/public") < dash.branch.indexOf(dash.leaf),
      `host mount /public precedes dashboard leaf in branch (${dash.branch.join(" → ")})`],
    [home.leaf.includes("landing__public"), `GET / → leaf "${home.leaf}"`],
    [dashHtml.includes('data-testid="dashboard-base"'), "dashboard renders BASE UI marker"],
    [!dashHtml.includes("dashboard-tenant"), "dashboard does NOT render tenant marker"],
    [dashHtml.includes("apiClient:ok"), "apiClient injected into dashboard component"],
    [homeHtml.includes("apiClient:ok"), "apiClient injected into landing (UI-only plugin)"],
    [stats.users === 42 && stats.projects === 7, `apiClient.dashboard.getStats() → ${stats.users} users / ${stats.projects} projects`],
  ]);
}

main().catch((err) => {
  console.error("verify crashed:", err);
  process.exit(1);
});
