import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeApp, type WebPluginModule } from "./compose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the remote trees by transpiling the actual remote source files (tsx).
// This skips Module Federation networking so the verify step is deterministic —
// composeApp() + router matching is what we're proving here.
async function importRemoteTree(remoteName: string): Promise<WebPluginModule> {
  const entry = path.resolve(__dirname, `../../remote-${remoteName}/src/tree.tsx`);
  const mod = await import(pathToFileURL(entry).href);
  return { name: remoteName, tree: mod.tree ?? {} } as WebPluginModule;
}

const EXPECTED = [
  { path: "/", plugin: "landing" },
  { path: "/about", plugin: "landing" },
  { path: "/dashboard", plugin: "dashboard" },
  { path: "/dashboard/analytics", plugin: "dashboard" },
  { path: "/settings", plugin: "settings" },
  { path: "/settings/profile", plugin: "settings" },
  { path: "/admin/users", plugin: "settings" },
  { path: "/blog", plugin: "filebased" },
  { path: "/blog/hello-world", plugin: "filebased" },
  { path: "/account", plugin: "filebased" },
] as const;

async function main() {
  const plugins: WebPluginModule[] = [
    await importRemoteTree("landing"),
    await importRemoteTree("dashboard"),
    await importRemoteTree("settings"),
    await importRemoteTree("filebased"),
  ];

  const { routeTree, mountCounts, pluginTreeChildren } = composeApp(plugins);

  console.log("\n=== composeApp result ===");
  console.log("mountCounts:", mountCounts);
  console.log("plugin tree children:", pluginTreeChildren);
  console.log(
    "composed root children:",
    (routeTree as unknown as { children?: unknown[] }).children?.length,
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const matched = (router as unknown as {
    getMatchedRoutes: (p: string) => {
      foundRoute: { id: string } | undefined;
      matchedRoutes: Array<{ id: string }>;
    };
  }).getMatchedRoutes;

  console.log("\n=== route matching (cross-remote URLs) ===");
  let failures = 0;
  for (const expected of EXPECTED) {
    let matchId = "";
    let branch: string[] = [];
    try {
      const res = matched(expected.path);
      if (res.foundRoute === undefined) throw new Error("no match");
      matchId = res.foundRoute.id;
      branch = res.matchedRoutes.map((m) => m.id);
      if (!branch.includes(matchId)) throw new Error("leaf not in branch");
    } catch (err) {
      failures += 1;
      console.log(
        `  FAIL  ${expected.path.padEnd(24)} ${expected.plugin}  (${(err as Error).message})`,
      );
      continue;
    }
    console.log(`  ok    ${expected.path.padEnd(24)} ${expected.plugin}  matched=${matchId}`);
  }

  // Structural check: the host mount layout must be an ancestor of the grafted
  // leaf in the branch, i.e. mount "/id" must appear before the leaf route id.
  let branchFailures = 0;
  console.log("\n=== host mount in render branch ===");
  for (const expected of EXPECTED) {
    const res = matched(expected.path);
    const ids = res?.matchedRoutes.map((m) => m.id) ?? [];
    const leaf = ids.at(-1) ?? "";
    const mountId = `/${leaf.split("/")[1]}`;
    const mountIndex = ids.indexOf(mountId);
    const leafIndex = ids.indexOf(leaf);
    const ok = mountIndex >= 0 && leafIndex > mountIndex;
    if (!ok) branchFailures += 1;
    console.log(`  ${ok ? "ok" : "FAIL"}  ${expected.path.padEnd(24)} host mount ${mountId} before ${leaf}`);
  }

  const totalFailures = failures + branchFailures;
  console.log(
    `\n=== RESULT: ${totalFailures === 0 ? `PASS — ${EXPECTED.length}/${EXPECTED.length} routes grafted, matched, and include host mount in render branch` : `${totalFailures} FAILURES`} ===`,
  );

  process.exit(totalFailures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify crashed:", err);
  process.exit(1);
});