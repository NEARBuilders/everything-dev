/**
 * Host client — hydration in the Start shape with runtime composition: read
 * __COMPOSE__ → register remotes → loadRemote route configs → constructTree →
 * createRouter → hydrateRoot(RouterClient). This async pre-hydration phase is
 * the one divergence from TanStack Start's managed entry (Start owns a
 * build-time route tree; the host composes one at runtime from manifests).
 *
 * Built by rsbuild.client.config.ts: the BUILD's MF runtime owns the share
 * scope (same exact-strict singleton recipe as the server build), so this
 * module uses the global registerRemotes/loadRemote API against that instance
 * — one React/router across host client and containers by share-scope
 * negotiation, no import map, no hand-built vendors.
 */
import { createBrowserHistory, createRouter } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { hydrateRoot } from "react-dom/client";
import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";
import { PluginManifestSchema, type PluginManifest } from "@manifest-compose/shared";
import { constructTree, type HostContext, type RouteOptionsModule } from "./construct";

interface ComposePayload {
  app: string;
  digest: string;
  manifests: Array<PluginManifest>;
  /** Deployed remotes: name/entry are the DEPLOYMENT identity, key is the
   * composition identity (descriptor plugin key). loadRemote must target by
   * key — manifest.name (e.g. "landing") does not identify the deployed
   * remote (e.g. "landingTenant") when a tenant swaps a plugin's workspace. */
  remotes: Array<{ name: string; entry: string; key: string }>;
  nav: Array<{ path: string; label: string; order?: number }>;
}

declare global {
  interface Window {
    __COMPOSE__: ComposePayload;
    $_TSR?: { hydrated?: boolean };
    __CLIENT_PROGRESS__: string[];
  }
}

const PROGRESS = (window.__CLIENT_PROGRESS__ = window.__CLIENT_PROGRESS__ ?? []);
const mark = (message: string) => {
  PROGRESS.push(message);
  console.log(`[client] ${message}`);
};

// L1: the BUILD runtime instance (native share scope from the build's shared
// config) via the global API — one page, one scope (mirror of server.tsx).
const instance = (globalThis as any).__FEDERATION__.__INSTANCES__?.[0];

async function initializeShareScope() {
  const sharing = instance?.initializeSharing?.("default");
  if (sharing instanceof Promise) await sharing;
  else if (Array.isArray(sharing)) await Promise.all(sharing);
}

try {
  const cfg = window.__COMPOSE__;
  mark(`payload ${cfg.app} ${cfg.digest}`);

  for (const remote of cfg.remotes) {
    registerRemotes([{ name: remote.name, entry: remote.entry, alias: remote.name }]);
    mark(`remote registered ${remote.name} @ ${remote.entry}`);
  }
  await initializeShareScope();
  mark("share scope initialized");

  const manifests = new Map<string, PluginManifest>(
    cfg.manifests.map((m) => {
      const parsed = PluginManifestSchema.parse(m);
      return [parsed.name, parsed];
    }),
  );

  const tree = await constructTree(
    {
      name: cfg.app,
      plugins: Object.fromEntries(
        cfg.manifests.map((m) => [m.name, { key: m.name, source: { kind: "remote", mfName: m.name, url: "" } }]),
      ),
    },
    async (ref) => {
      const manifest = manifests.get(ref.key);
      if (!manifest) throw new Error(`no embedded manifest for plugin "${ref.key}"`);
      const remote = cfg.remotes.find((r) => r.key === ref.key);
      if (!remote) throw new Error(`no remote registered for plugin "${ref.key}"`);
      const mfName = remote.name;
      mark(`loadRemote ${mfName}/routeConfig…`);
      const mod = (await loadRemote(`${mfName}/routeConfig`, { from: "build" })) as any;
      const routeConfig = (mod?.default ?? mod) as RouteOptionsModule;
      if (!routeConfig) throw new Error(`loadRemote(${mfName}/routeConfig) returned nothing`);
      mark(`loaded ${mfName}/routeConfig`);
      return { key: ref.key, mfName, manifest, routeConfig };
    },
  );
  mark(`tree constructed, digest ${tree.digest}, nav ${tree.nav.length}`);

  if (tree.digest !== cfg.digest) {
    mark(`DIGEST PARITY FAILURE server=${cfg.digest} client=${tree.digest} — falling back to full CSR re-render`);
  }

  const session: HostContext = {}; // prototype: anon session; production forwards the request session

  const router = createRouter({
    routeTree: tree.rootRoute as any,
    history: createBrowserHistory(),
    context: session,
  });

  mark(`hydrateRoot, $_TSR present: ${Boolean(window.$_TSR)}`);
  hydrateRoot(document.getElementById("root")!, <RouterClient router={router} />);
  mark("hydrateRoot called");

  // RouterClient's h() sets hydrated=true and TanStack's cleanup deletes
  // $_TSR in the same tick once the stream ended — so consuming the
  // bootstrap is the durable "hydration settled" signal. Watch for it so
  // every red run shows which side of it we died on.
  const bootstrapWatch = setInterval(() => {
    if (window.$_TSR === undefined) {
      clearInterval(bootstrapWatch);
      mark("hydration consumed ($_TSR deleted — h() ran)");
    }
  }, 50);
} catch (err) {
  mark(`ENTRY ERROR: ${(err as Error).stack ?? (err as Error).message}`);
}
