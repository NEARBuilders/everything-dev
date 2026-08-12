import { registerRemotes, loadRemote } from "@module-federation/enhanced/runtime";
import { createRouter } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import React from "react";
import { RouterProvider } from "@tanstack/react-router";
import { composeApp, type WebPluginModule } from "./compose";

const REMOTES: Array<{ name: string; entry: string }> = [
  { name: "remote_landing", entry: "http://localhost:3101/remoteEntry.js" },
  { name: "remote_dashboard", entry: "http://localhost:3102/remoteEntry.js" },
  { name: "remote_settings", entry: "http://localhost:3103/remoteEntry.js" },
  { name: "remote_filebased", entry: "http://localhost:3104/remoteEntry.js" },
];

async function loadPlugins(): Promise<WebPluginModule[]> {
  registerRemotes(
    REMOTES.map((r) => ({ name: r.name, entry: r.entry })),
  );

  const results = await Promise.all(
    REMOTES.map(async (remote) => {
      const mod = (await loadRemote<any>(`${remote.name}/tree`)) ?? {};
      const module = mod?.default && mod.default.tree ? mod.default : mod;
      console.log(`[host] loaded ${remote.name}:`, {
        exports: typeof module === "object" && module ? Object.keys(module) : typeof module,
        hasTree: module?.tree !== undefined,
      });
      return {
        name: remote.name.replace("remote_", ""),
        tree: module?.tree ?? {},
      } as WebPluginModule;
    }),
  );

  return results;
}

async function boot() {
  try {
    const plugins = await loadPlugins();
    const { routeTree, mountCounts, pluginTreeChildren } = composeApp(plugins);

    console.log("[host] composeApp result", {
      mountCounts,
      pluginTreeChildren,
      rootChildCount: routeTree.children?.length,
    });

    const router = createRouter({ routeTree });

    const mountNode = document.getElementById("root")!;
    createRoot(mountNode).render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>,
    );

    (window as unknown as Record<string, unknown>).__COMPOSE_RESULT__ = {
      mountCounts,
      pluginTreeChildren,
    };
  } catch (err) {
    console.error("[host] boot failed", err);
    document.getElementById("root")!.innerHTML =
      `<pre style="color:#f00;padding:16px">${err instanceof Error ? err.stack : String(err)}</pre>`;
  }
}

boot();