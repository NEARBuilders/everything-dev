import { registerRemotes, loadRemote } from "@module-federation/enhanced/runtime";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import React from "react";
import { composeApp, type WebPluginModule } from "./compose";
import { MOCK_USER } from "./mount-registry";
import { apps, resolveApp, type ResolvedApp } from "./configs";
import { loadApiClient, type ApiClient } from "./api-client";
import type { ResolveContext } from "./resolver";

const PORTS: Record<string, number> = {
  "remote-dashboard-api": 3101,
  "remote-dashboard-ui": 3102,
  "remote-landing": 3103,
  "remote-tenant-dashboard-ui": 3104,
};

const REMOTE_NAMES: Record<string, string> = {
  "remote-dashboard-api": "remote_dashboard_api",
  "remote-dashboard-ui": "remote_dashboard_ui",
  "remote-landing": "remote_landing",
  "remote-tenant-dashboard-ui": "remote_tenant_dashboard_ui",
};

function activeConfigId(): string {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("config");
  return id && apps[id] ? id : "base";
}

function devContext(): ResolveContext {
  return {
    mode: "development",
    configDir: ".",
    portMap: new Map(Object.entries(PORTS)),
    nameOf: (path) => REMOTE_NAMES[path] ?? path.split("/").filter(Boolean).join("-"),
  };
}

async function loadPlugins(config: ResolvedApp): Promise<WebPluginModule[]> {
  return Promise.all(
    config.ui.map(async (u) => {
      const mod = (await loadRemote<any>(`${u.name}/tree`)) ?? {};
      const module = mod?.default && mod.default.tree ? mod.default : mod;
      console.log(`[host] loaded ${u.ns} tree from ${u.name}`, {
        hasTree: module?.tree !== undefined,
      });
      return { name: u.ns, tree: module?.tree ?? {} } as WebPluginModule;
    }),
  );
}

async function boot() {
  try {
    const configId = activeConfigId();
    const config = await resolveApp(apps[configId], devContext());

    registerRemotes(
      [...config.api, ...config.ui].map((r) => ({ name: r.name, entry: r.entry })),
    );

    const [apiClient, plugins] = await Promise.all([loadApiClient(config), loadPlugins(config)]);
    const { routeTree, mountCounts, pluginTreeChildren } = composeApp(plugins);

    console.log(`[host] composeApp (config=${configId})`, { mountCounts, pluginTreeChildren });

    const router = createRouter({
      routeTree,
      context: { apiClient: apiClient as ApiClient, user: MOCK_USER },
    });

    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>,
    );

    (window as unknown as Record<string, unknown>).__COMPOSE_RESULT__ = {
      configId,
      mountCounts,
      pluginTreeChildren,
      apiClientKeys: Object.keys(apiClient),
    };
  } catch (err) {
    console.error("[host] boot failed", err);
    document.getElementById("root")!.innerHTML =
      `<pre style="color:#f00;padding:16px">${err instanceof Error ? err.stack : String(err)}</pre>`;
  }
}

boot();
