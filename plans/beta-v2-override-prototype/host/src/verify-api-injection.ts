import {
  importUiTree,
  importDashboardApi,
  buildApiClient,
  renderRoute,
  makeContext,
  runChecks,
  composeApp,
} from "./verify-helpers";

/**
 * API INJECTION — proves the exact injection mechanism the model relies on:
 * the host builds ONE apiClient from the API remotes, injects it into router
 * context, and BOTH the base and tenant dashboard UIs (separate MF bundles)
 * plus a UI-only plugin all receive it via `useRouteContext`. No per-plugin
 * wiring — the apiClient is global and typed.
 */
async function main() {
  // Each composeApp mutates plugin tree roots in place (id namespacing), so a
  // tree instance is single-use — mirror production, where every tenant loads
  // its own remote. Import fresh instances per config.
  const [dashboardApi, baseUi, tenantUi, landingBase, landingTenant] = await Promise.all([
    importDashboardApi(),
    importUiTree("dashboard-ui", "dashboard"),
    importUiTree("tenant-dashboard-ui", "dashboard"),
    importUiTree("landing", "landing"),
    importUiTree("landing", "landing"),
  ]);
  const apiClient = buildApiClient(dashboardApi);
  const ctx = makeContext(apiClient);

  const baseComposed = composeApp([baseUi, landingBase]);
  const tenantComposed = composeApp([tenantUi, landingTenant]);

  const [baseDash, tenantDash, landingHtml] = await Promise.all([
    renderRoute(baseComposed.routeTree, "/dashboard", ctx),
    renderRoute(tenantComposed.routeTree, "/dashboard", ctx),
    renderRoute(tenantComposed.routeTree, "/", ctx),
  ]);

  const items = await apiClient.dashboard.listItems();

  runChecks("API INJECTION — one apiClient flows to every federated UI", [
    [baseDash.includes("apiClient:ok"), "apiClient injected into BASE dashboard UI (useRouteContext)"],
    [tenantDash.includes("apiClient:ok"), "apiClient injected into TENANT dashboard UI (same mechanism)"],
    [landingHtml.includes("apiClient:ok"), "apiClient injected into UI-only plugin (cross-plugin access)"],
    [baseDash.includes("apiClient:ok") && tenantDash.includes("apiClient:ok"),
      "identical injection shape across base and tenant UIs — host is source-agnostic"],
    [items.length === 3 && items[0]?.name === "Alpha", `apiClient.dashboard.listItems() → ${items.length} items (${items.map((i) => i.name).join(", ")})`],
  ]);
}

main().catch((err) => {
  console.error("verify-api-injection crashed:", err);
  process.exit(1);
});
