import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { composeApp } from "./compose";

/**
 * Probe: what does TanStack Router do when two plugins on the same mount both
 * contribute the same leaf path (e.g. both `_public` roots declare `/blog`)?
 *
 * The subtree ROOT ids are auto-namespaced (`a__public`, `b__public`) so ids
 * don't collide — but the leaf PATHS both match `/blog`. This determines the
 * collision policy (error vs first-wins).
 */

function makePlugin(name: string) {
  const rootRoute = createRootRoute();
  const publicRoot = createRoute({
    getParentRoute: () => rootRoute,
    id: "_public",
    component: () => null,
  });
  const blogRoute = createRoute({
    getParentRoute: () => publicRoot,
    path: "/blog",
    component: () => null,
  });
  return {
    name,
    tree: rootRoute.addChildren([publicRoot.addChildren([blogRoute])]),
  };
}

async function main() {
  const plugins = [makePlugin("a"), makePlugin("b")];
  const { routeTree } = composeApp(plugins);

  console.log("=== two plugins, same leaf path /blog on same mount ===\n");
  try {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/blog"] }),
    });
    const matched = (router as any).getMatchedRoutes("/blog");
    const branch = matched.matchedRoutes.map((m: { id: string }) => m.id);
    const leaf = matched.foundRoute?.id;
    console.log("ROUTER BUILT OK (no duplicate-id error)");
    console.log("matched branch:", branch);
    console.log("found leaf:", leaf);
    console.log("=> policy: FIRST-WINS, no error. The id-namespaced subtree roots keep ids unique; the duplicate leaf path silently resolves to one match.");
  } catch (err) {
    console.log("ROUTER THREW:");
    console.log((err as Error).message);
    console.log("=> policy: ERROR-ON-COLLISION (TSR rejects the duplicate path)");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
