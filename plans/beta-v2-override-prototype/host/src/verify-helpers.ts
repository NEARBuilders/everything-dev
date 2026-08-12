import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import React from "react";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeApp, type WebPluginModule } from "./compose";
import { MOCK_USER } from "./mount-registry";

// tsx transpiles remote .tsx sources to classic JSX (React.createElement), so
// the remote components need `React` in scope even though they only import the
// react-jsx runtime. Mirrors verify-ssr.tsx in the web-grafting prototype.
(globalThis as Record<string, unknown>).React = React;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Import a remote's route tree by transpiling its actual source (skips MF
 * networking so verify is deterministic). `remoteDir` is the workspace folder
 * under `plans/beta-v2-override-prototype/`. A fresh instance per call is
 * guaranteed via cache-busting — composeApp mutates tree roots in place, so a
 * tree is single-use (mirrors production, where every tenant loads its own
 * remote).
 */
export async function importUiTree(remoteDir: string, ns: string): Promise<WebPluginModule> {
  const entry = path.resolve(__dirname, `../../remote-${remoteDir}/src/tree.tsx`);
  const bust = `${pathToFileURL(entry).href}?v=${Math.random().toString(36).slice(2)}`;
  const mod = await import(bust);
  return { name: ns, tree: mod.tree ?? {} } as WebPluginModule;
}

/** Import the dashboard API module directly from disk (same source the MF remote exposes). */
export async function importDashboardApi(): Promise<{
  getStats: () => Promise<{ users: number; projects: number; revenue: number }>;
  listItems: () => Promise<Array<{ id: number; name: string }>>;
}> {
  const entry = path.resolve(__dirname, "../../remote-dashboard-api/src/index.ts");
  const mod = await import(pathToFileURL(entry).href);
  return { getStats: mod.getStats, listItems: mod.listItems };
}

export function buildApiClient(api: {
  getStats: () => Promise<{ users: number; projects: number; revenue: number }>;
  listItems: () => Promise<Array<{ id: number; name: string }>>;
}) {
  return { dashboard: { getStats: api.getStats, listItems: api.listItems } };
}

export interface MatchResult {
  leaf: string;
  branch: string[];
  params: Record<string, string>;
}

/** Match a path against the composed tree and return the leaf id + render branch. */
export async function match(routeTree: AnyRoute, target: string): Promise<MatchResult> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [target] }),
  });
  await router.load();
  const api = (router as unknown as {
    getMatchedRoutes: (p: string) => {
      foundRoute: { id: string } | undefined;
      matchedRoutes: Array<{ id: string }>;
      routeParams: Record<string, string>;
    };
  }).getMatchedRoutes;
  const res = api(target);
  if (res.foundRoute === undefined) throw new Error(`no match for ${target}`);
  return {
    leaf: res.foundRoute.id,
    branch: res.matchedRoutes.map((m) => m.id),
    params: res.routeParams ?? {},
  };
}

/** Server-render the composed tree at a path with a context and return the HTML string. */
export async function renderRoute(
  routeTree: AnyRoute,
  target: string,
  context: Record<string, unknown>,
): Promise<string> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [target] }),
    context,
  });
  await router.load();
  return renderToString(React.createElement(RouterProvider, { router }));
}

export function makeContext(apiClient: unknown): Record<string, unknown> {
  return { apiClient, user: MOCK_USER };
}

export function check(cond: boolean, label: string): number {
  if (cond) {
    console.log(`  ok    ${label}`);
    return 0;
  }
  console.log(`  FAIL  ${label}`);
  return 1;
}

export function runChecks(name: string, checks: Array<[boolean, string]>): void {
  console.log(`\n=== ${name} ===`);
  let failures = 0;
  for (const [cond, label] of checks) {
    failures += check(cond, label);
  }
  console.log(`\n=== RESULT: ${failures === 0 ? "PASS" : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

export { composeApp, type WebPluginModule };
