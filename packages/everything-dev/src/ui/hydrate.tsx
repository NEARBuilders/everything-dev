/**
 * Client bootstrap — creates browser-side QueryClient, Router, and auth/API
 * clients; composes the route tree from the runtime-config payload before
 * hydration (payload -> registerRemotes -> loadRemote route configs ->
 * constructTree -> hydrateRoot(RouterClient)). Called from the host-rendered
 * HTML shell via the app's thin entry/hydrate stubs. The build's MF runtime
 * owns the page's share scope — the global registerRemotes/loadRemote API
 * bridges it (one React/router across the core client and plugin containers
 * by share-scope negotiation).
 */

import type { QueryClient } from "@tanstack/react-query";
import type { ClientRuntimeConfig } from "../types";
import { createApiClient } from "./api";
import { createAuthClient } from "./auth";
import {
  CORE_UI_PLUGIN_KEY,
  ComposePayloadSchema,
  constructTree,
  type NavManifest,
  type PluginManifest,
  parsePluginManifest,
  type RouteConfigModule,
} from "./manifest";
import { defaultQueryClient } from "./router-defaults";
import { getCspNonce, getRuntimeConfig } from "./runtime";
import type { AppRouterFactory } from "./types";

declare global {
  interface Window {
    __EVERYTHING_DEV_HYDRATE_PROMISE__?: Promise<void>;
    __EVERYTHING_DEV_SSR__?: boolean;
    __CLIENT_PROGRESS__?: string[];
    $_TSR?: unknown;
  }
}

const mark = (message: string) => {
  const progress = window.__CLIENT_PROGRESS__ ?? [];
  window.__CLIENT_PROGRESS__ = [...progress, message];
  if (import.meta.env.DEV) console.log(`[Hydrate] ${message}`);
};

function isAbsoluteHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export type { AppRouterFactory } from "./types";

export interface CoreHydrateOptions {
  /**
   * Loads the app's generated core route config — the only app-specific
   * input; clients, compose machinery, and the router come from the package.
   */
  routeConfig: () => Promise<RouteConfigModule | { default: RouteConfigModule }>;
  /**
   * Loads the app's generated core manifest — the degradation target when the
   * runtime config carries no (or no usable) compose payload: a plugin-free
   * deployment has no payload at all, yet the core-only tree is still the
   * tree. Absent, a payload-less page cannot construct a tree. The value is
   * parsed through the manifest contract at the boundary (a skewed version
   * or shape fails loudly here).
   */
  manifest?: () => Promise<unknown>;
  /**
   * The app's authored router factory — notFound/pending/error components,
   * scroll behavior, and router defaults live there. Absent, the framework's
   * own factory runs.
   */
  createRouter?: AppRouterFactory;
  /** The app's query client factory (staleTime, gcTime, …). Absent, the framework default. */
  createQueryClient?: () => QueryClient;
  /** Overrides the runtime config source (tests, embeds). */
  config?: ClientRuntimeConfig;
}

interface ComposedTree {
  routeTree: unknown;
  nav: NavManifest;
  /** `true` when plugin composition failed and only the core tree is usable. */
  degraded: boolean;
}

/**
 * Manifest composition: reconstruct the server's tree from the payload — the
 * same manifests, the same MF names, the same construction code. Digest
 * parity proves the SSR'd tree and this tree are identical before hydrate;
 * any failure degrades to the core-only tree (still a real route tree — the
 * page must render, just without plugin routes) rather than leaving the
 * router without a tree.
 */
async function composeFromPayload(
  runtimeConfig: ClientRuntimeConfig,
  coreRouteConfig: RouteConfigModule,
  coreManifest: PluginManifest | undefined,
): Promise<ComposedTree | undefined> {
  const coreUiName = runtimeConfig.ui?.name ?? CORE_UI_PLUGIN_KEY;

  // The core-only tree is the degradation target for every failure below —
  // the payload's core manifest plus the app's own route config, no remotes.
  const composeCoreOnly = async (
    candidateManifests: PluginManifest[],
  ): Promise<ComposedTree | undefined> => {
    try {
      const core = candidateManifests.find((m) => m.name === CORE_UI_PLUGIN_KEY);
      if (!core) return undefined;
      const tree = await constructTree({
        name: "core-fallback",
        plugins: [{ key: core.name, mfName: coreUiName }],
        resolve: async (ref) => ({
          key: ref.key,
          manifest: core,
          routeConfig: coreRouteConfig,
        }),
        rootOptions: coreRouteConfig.rootMeta,
      });
      mark(
        `core-only tree constructed: ${tree.manifests.length} source(s), ${tree.nav.items.length} nav item(s)`,
      );
      return { routeTree: tree.rootRoute, nav: tree.nav, degraded: true };
    } catch (error) {
      console.error("[Hydrate] Core-only fallback failed:", error);
      mark(`CORE-ONLY FALLBACK ERROR: ${(error as Error).message}`);
      return undefined;
    }
  };

  const payload = runtimeConfig.ui?.compose;
  if (!payload?.remotes) {
    // No payload at all — a plugin-free deployment. The core-only tree IS
    // the tree; without the app manifest there is nothing to construct.
    return coreManifest ? composeCoreOnly([coreManifest]) : undefined;
  }

  const parsed = ComposePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    mark(`compose payload malformed: ${parsed.error.message}`);
    return coreManifest ? composeCoreOnly([coreManifest]) : undefined;
  }
  const { manifests } = parsed.data;
  const manifestByKey = new Map(manifests.map((m) => [m.name, m]));

  try {
    const { registerRemotes, loadRemote } = await import("@module-federation/enhanced/runtime");

    mark(`compose payload: digest ${payload.digest}, ${payload.remotes.length} remote(s)`);

    registerRemotes(
      payload.remotes.map((remote) => ({
        name: remote.name,
        alias: remote.name,
        // Manifest-driven registration: the manifest carries the remote's
        // true container identity (its build-time package name), which the
        // plain remoteEntry URL cannot resolve — the entry script's global
        // name doesn't match the registered name. Versioned deploys carry
        // the (hashed) manifest URL in the payload; legacy payloads derive
        // it by stripping the fixed entry name. Only absolute URLs qualify —
        // a relative manifestUrl would resolve against the page origin and
        // register the wrong container.
        entry: isAbsoluteHttpUrl(remote.manifestUrl)
          ? remote.manifestUrl
          : remote.entry.replace(/\/?remoteEntry\.js$/, "/mf-manifest.json"),
      })),
    );
    for (const remote of payload.remotes) {
      mark(`remote registered ${remote.name} @ ${remote.entry}`);
    }

    // Per-source isolation (ADR 0024 §5): a remote whose route config fails
    // to load drops only its own routes. The dropped set degrades the compose
    // (client-render — the SSR'd tree included it), never the whole page.
    const loadedRouteConfigs = new Map<string, RouteConfigModule>();
    const dropped: string[] = [];
    const healthyManifests: PluginManifest[] = [];
    for (const manifest of manifests) {
      if (manifest.name === CORE_UI_PLUGIN_KEY) {
        healthyManifests.push(manifest);
        continue;
      }
      const remote = payload.remotes.find((r) => r.key === manifest.name);
      if (!remote) {
        dropped.push(manifest.name);
        mark(`dropped ${manifest.name} — payload has no matching remote`);
        continue;
      }
      try {
        const mod = await loadRemote(`${remote.name}/routeConfig`, { from: "build" });
        const routeConfig = ((mod as { default?: RouteConfigModule })?.default ??
          mod) as RouteConfigModule;
        if (!routeConfig?.routeConfigLoaders) {
          throw new Error(`loadRemote(${remote.name}/routeConfig) returned no route config`);
        }
        loadedRouteConfigs.set(manifest.name, routeConfig);
        healthyManifests.push(manifest);
        mark(`loaded ${remote.name}/routeConfig`);
      } catch (error) {
        dropped.push(manifest.name);
        mark(`dropped ${manifest.name} — ${(error as Error).message}`);
      }
    }

    const tree = await constructTree({
      name: "client",
      plugins: healthyManifests.map((manifest) => {
        const remote = payload.remotes.find((r) => r.key === manifest.name);
        return {
          key: manifest.name,
          mfName:
            remote?.name ?? (manifest.name === CORE_UI_PLUGIN_KEY ? coreUiName : manifest.name),
        };
      }),
      resolve: async (ref) => {
        if (ref.key === CORE_UI_PLUGIN_KEY) {
          const manifest = manifestByKey.get(ref.key);
          if (!manifest) throw new Error(`compose payload has no manifest for "${ref.key}"`);
          return { key: ref.key, manifest, routeConfig: coreRouteConfig };
        }
        const manifest = manifestByKey.get(ref.key);
        const routeConfig = loadedRouteConfigs.get(ref.key);
        if (!manifest || !routeConfig) {
          throw new Error(`composition source "${ref.key}" is not fully resolved`);
        }
        return { key: ref.key, manifest, routeConfig };
      },
      rootOptions: coreRouteConfig.rootMeta,
    });

    if (dropped.length > 0) {
      mark(`degraded compose: ${dropped.join(", ")} dropped — client-render`);
      return { routeTree: tree.rootRoute, nav: tree.nav, degraded: true };
    }

    if (tree.digest !== payload.digest) {
      console.warn(
        `[Hydrate] Compose digest mismatch (client ${tree.digest} vs server ${payload.digest}); core-only fallback`,
      );
      mark(`DIGEST PARITY FAILURE server=${payload.digest} client=${tree.digest}`);
      return composeCoreOnly(manifests);
    }

    mark(
      `tree constructed: ${tree.manifests.length} source(s), ${tree.nav.items.length} nav item(s)`,
    );
    return { routeTree: tree.rootRoute, nav: tree.nav, degraded: false };
  } catch (error) {
    console.error("[Hydrate] Client compose failed; core-only fallback:", error);
    mark(`CLIENT COMPOSE ERROR: ${(error as Error).message}`);
    return composeCoreOnly(manifests);
  }
}

function isServerRendered(): boolean {
  if (document.documentElement.hasAttribute("data-everything-ssr")) {
    return true;
  }
  if (window.__EVERYTHING_DEV_SSR__ !== undefined) {
    return window.__EVERYTHING_DEV_SSR__;
  }
  return window.$_TSR !== undefined;
}

function watchHydrationConsumed() {
  const bootstrapWatch = setInterval(() => {
    if (window.$_TSR === undefined) {
      clearInterval(bootstrapWatch);
      mark("hydration consumed ($_TSR deleted — h() ran)");
    }
  }, 50);
}

export async function hydrate(options: CoreHydrateOptions) {
  if (window.__EVERYTHING_DEV_HYDRATE_PROMISE__) {
    return window.__EVERYTHING_DEV_HYDRATE_PROMISE__;
  }

  const hydratePromise = (async () => {
    console.log("[Hydrate] Starting...");

    const runtimeConfig = options.config ?? getRuntimeConfig();
    const cspNonce = getCspNonce();

    if (!runtimeConfig.hostUrl || !runtimeConfig.rpcBase) {
      throw new Error("Missing hostUrl or rpcBase in runtime config");
    }

    const [{ QueryClientProvider }, routerFactory] = await Promise.all([
      import("@tanstack/react-query"),
      options.createRouter
        ? Promise.resolve(options.createRouter)
        : import("./router-client").then((m) => m.createRouter as AppRouterFactory),
    ]);
    const [coreRouteConfig] = await Promise.all([
      options.routeConfig().then((mod) => ("default" in mod ? mod.default : mod)),
    ]);
    const coreManifest = options.manifest
      ? await options
          .manifest()
          .then((raw) =>
            typeof raw === "object" && raw !== null && "default" in raw
              ? (raw as { default: unknown }).default
              : raw,
          )
          .then((raw) => parsePluginManifest(raw))
      : undefined;
    const client = options.createQueryClient?.() ?? defaultQueryClient();

    mark(`$_TSR present: ${Boolean(window.$_TSR)}`);

    const composed = await composeFromPayload(runtimeConfig, coreRouteConfig, coreManifest);

    const { router, queryClient: builtClient } = await routerFactory({
      routeTree: composed?.routeTree,
      context: {
        pluginNav: composed?.nav,
        queryClient: client,
        runtimeConfig,
        cspNonce,
        apiClient: createApiClient({
          hostUrl: runtimeConfig.hostUrl,
          rpcBase: runtimeConfig.rpcBase,
        }),
        authClient: createAuthClient({ runtimeConfig, cspNonce }),
      },
    });
    const providerClient = builtClient ?? client;

    // A server-rendered page whose compose degraded to core-only would
    // hydrate a DIFFERENT tree than the HTML contains — a guaranteed React
    // hydration failure. Client-render cleanly instead; hydration is only
    // safe when the composed tree is the one the server rendered.
    const canHydrate = isServerRendered() && Boolean(composed) && !composed!.degraded;

    if (canHydrate) {
      const { hydrateRoot } = await import("react-dom/client");
      const { RouterClient } = await import("@tanstack/react-router/ssr/client");

      console.log("[Hydrate] Calling hydrateRoot...");
      hydrateRoot(
        document,
        <QueryClientProvider client={providerClient}>
          <RouterClient router={router} />
        </QueryClientProvider>,
      );
      watchHydrationConsumed();
    } else {
      const { createRoot } = await import("react-dom/client");
      const { RouterProvider } = await import("@tanstack/react-router");

      console.log("[Hydrate] Calling createRoot...");
      createRoot(document).render(
        <QueryClientProvider client={providerClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
    }

    console.log("[Hydrate] Complete!");
  })().catch((error) => {
    console.error("[Hydrate] Failed:", error);
    window.__EVERYTHING_DEV_HYDRATE_PROMISE__ = undefined;
    throw error;
  });

  window.__EVERYTHING_DEV_HYDRATE_PROMISE__ = hydratePromise;
  return hydratePromise;
}

export default hydrate;
