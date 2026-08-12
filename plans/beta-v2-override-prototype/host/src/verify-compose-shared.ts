import {
  importUiTree,
  match,
  runChecks,
  composeApp,
} from "./verify-helpers";

/**
 * COMPOSE SHARED — proves `composeApp()` is fully source-agnostic. Both the
 * base and tenant configs hand it the same `{ name, tree }` shape; the
 * resulting route ids and mount structure are identical even though the
 * dashboard tree came from a different remote in each case.
 */
async function main() {
  // Fresh tree instances per compose (composeApp mutates roots in place).
  const [baseDash, tenantDash, landingBase, landingTenant] = await Promise.all([
    importUiTree("dashboard-ui", "dashboard"),
    importUiTree("tenant-dashboard-ui", "dashboard"),
    importUiTree("landing", "landing"),
    importUiTree("landing", "landing"),
  ]);

  const baseComposed = composeApp([baseDash, landingBase]);
  const tenantComposed = composeApp([tenantDash, landingTenant]);

  const baseMatch = await match(baseComposed.routeTree, "/dashboard");
  const tenantMatch = await match(tenantComposed.routeTree, "/dashboard");

  runChecks("COMPOSE SHARED — composeApp is source-agnostic", [
    [JSON.stringify(baseComposed.mountCounts) === JSON.stringify(tenantComposed.mountCounts),
      `identical mountCounts across configs (${JSON.stringify(baseComposed.mountCounts)})`],
    [baseMatch.leaf === tenantMatch.leaf, `identical leaf id "${baseMatch.leaf}" from different remotes`],
    [JSON.stringify(baseMatch.branch) === JSON.stringify(tenantMatch.branch),
      `identical render branch (${baseMatch.branch.join(" → ")})`],
    [baseComposed.pluginTreeChildren.dashboard === 1 && tenantComposed.pluginTreeChildren.dashboard === 1,
      "pluginTreeChildren identical (1 mount root per plugin)"],
  ]);
}

main().catch((err) => {
  console.error("verify-compose-shared crashed:", err);
  process.exit(1);
});
