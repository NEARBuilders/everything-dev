/**
 * Bundled-host server — the production shape for gates 5/7: rspack-built
 * with the MF host plugin (build-level share provides via the global build
 * runtime), loads remote route-configs over HTTP, constructs the tree with
 * the SAME construction code as the disk path, health-checks at boot —
 * in-process gates PLUS a live post-listen self-probe (fail-loud, ADR 0007
 * §2) — then serves SSR + the hydration shell.
 *
 * Build:  bunx rsbuild build            (from host/)
 * Run:    APP=base|tenant PORT=3000 node dist/static/js/index.js
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { loadRemote, registerRemotes } from "@module-federation/enhanced/runtime";
import { PluginManifestSchema, type PluginManifest, type PluginRef } from "@manifest-compose/shared";
import { constructTree, type ConstructedTree, type HostContext, type PluginResolver } from "./construct";
import { resolveAppOrThrow, renderPath, ANON, ADMIN, bootHealth } from "./harness";
import { APPS, type AppKey } from "../../apps";

/**
 * The deploy map — the publish write-back stand-in (plan 028: local refs
 * resolve to deployed URLs at publish time; the prototype's map stands in
 * for the deploy service). Keyed by the descriptor's local path.
 */
const DEPLOY_MAP: Record<string, { mfName: string; ssrUrl: string }> = {
  "./remote-auth": { mfName: "auth", ssrUrl: "http://localhost:4001/ssr/remoteEntry.server.js" },
  "./remote-landing": { mfName: "landing", ssrUrl: "http://localhost:4002/ssr/remoteEntry.server.js" },
  "./remote-landing-tenant": { mfName: "landingTenant", ssrUrl: "http://localhost:4003/ssr/remoteEntry.server.js" },
};

function deployedSource(ref: PluginRef): { mfName: string; ssrEntryUrl: string; webEntryUrl: string } {
  const deployed = DEPLOY_MAP[ref.source.path];
  if (!deployed) throw new Error(`no deployed URL for local ref "${ref.source.path}" — add it to DEPLOY_MAP`);
  return {
    mfName: deployed.mfName,
    ssrEntryUrl: deployed.ssrUrl,
    webEntryUrl: deployed.ssrUrl.replace(/\/ssr\/remoteEntry\.server\.js$/, "/remoteEntry.js"),
  };
}

// L1: the BUILD runtime instance (native share scope from the build's shared
// config) via the global API — one process, one scope (ADR 0007 §5).
const instance = (globalThis as any).__FEDERATION__.__INSTANCES__?.[0];

const registered = new Map<string, string>();
function registerRemoteOnce(mfName: string, entryUrl: string) {
  if (registered.get(mfName) === entryUrl) return;
  registerRemotes([{ name: mfName, entry: entryUrl, alias: mfName }]);
  registered.set(mfName, entryUrl);
}

async function initializeShareScope() {
  const sharing = instance?.initializeSharing?.("default");
  if (sharing instanceof Promise) await sharing;
  else if (Array.isArray(sharing)) await Promise.all(sharing);
}

const manifestCache = new Map<string, PluginManifest>();
async function fetchManifest(mfName: string, ssrEntryUrl: string): Promise<PluginManifest> {
  const cached = manifestCache.get(mfName);
  if (cached) return cached;
  const res = await fetch(ssrEntryUrl.replace(/\/remoteEntry\.server\.js$/, "") + "/manifest.gen.json");
  if (!res.ok) throw new Error(`manifest fetch failed for ${mfName}: ${res.status}`);
  const manifest = PluginManifestSchema.parse(await res.json());
  manifestCache.set(mfName, manifest);
  return manifest;
}

// MF resolver: the PROD path — expose load over HTTP, descriptor-driven
const mfResolver: PluginResolver = async (ref) => {
  const { mfName, ssrEntryUrl } = deployedSource(ref);
  registerRemoteOnce(mfName, ssrEntryUrl);
  await initializeShareScope();
  const mod = (await loadRemote(`${mfName}/routeConfig`, { from: "build" })) as any;
  if (!mod) throw new Error(`loadRemote(${mfName}/routeConfig) returned nothing`);
  const routeConfig = (mod.default ?? mod) as any;
  return { key: ref.key, mfName, manifest: await fetchManifest(mfName, ssrEntryUrl), routeConfig };
};

// digest-keyed composition cache (ADR 0007 §1) — variants memoize by digest
const treeCache = new Map<string, ConstructedTree>();
async function composedTree(appKey: AppKey): Promise<ConstructedTree> {
  const app = resolveAppOrThrow(APPS, appKey);
  const tree = await constructTree(app, mfResolver);
  treeCache.set(tree.digest, tree);
  return tree;
}

function shell(tree: ConstructedTree, appKey: AppKey, html: string): string {
  const title = tree.headMetas.find((m) => m?.title)?.title ?? "app";
  const compose = {
    app: appKey,
    digest: tree.digest,
    manifests: tree.manifests,
    remotes: composedRemotes,
    nav: tree.nav,
  };
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${tree.headMetas
    .map((m) => (m?.title ? `<title>${m.title}</title>` : ""))
    .join("")}</head><body><div id="root">${html}</div><script>window.__COMPOSE__ = ${JSON.stringify(compose)};</script><script src="/__host/static/js/client.js" defer></script></body></html>`;
}

// ---- fail-loud boot health gate (ADR 0007 §2), then serve ----
const port = Number(process.env.PORT || 3000);
const appKey = (process.env.APP || "base") as AppKey;

const CASES = [
  { path: "/", ctx: ANON, expect: appKey === "tenant" ? "TENANT landing plugin" : "Landing index — BASE landing plugin" },
  { path: "/login", ctx: ANON, expect: "Login (auth plugin)" },
  { path: "/settings", ctx: ANON, status: 307 },
  { path: "/settings/api-keys", ctx: ADMIN, expect: "edk_demo" },
];

const composedRemotes = [
  ...new Map(
    Object.values(resolveAppOrThrow(APPS, appKey).plugins).map((ref) => {
      const d = deployedSource(ref);
      // `key` carries the COMPOSITION identity (descriptor plugin key) so the
      // client can target this deployment's remote by key — manifest.name
      // (e.g. "landing") does not identify the DEPLOYED remote (e.g.
      // "landingTenant") when a tenant swaps a plugin's workspace.
      return [d.mfName, { name: d.mfName, entry: d.webEntryUrl, key: ref.key }];
    }),
  ).values(),
];

const tree = await composedTree(appKey);
console.log(`[server] app="${appKey}" composed ${tree.manifests.length} plugin(s), digest=${tree.digest}`);

const failures = await bootHealth(tree, CASES);
if (failures > 0) {
  console.error(`[server] BOOT HEALTH CHECK FAILED (${failures}) — unhealthy (ADR 0007 §2)`);
  process.exit(1);
}
console.log("[server] health gate passed");

// Second-React guard probe (GUARD_ENTRY, optional): a remote built with a
// mismatched react requiredVersion (strictVersion) must be REJECTED with a
// version signature — not just any error, which would be a false pass.
const guardEntry = process.env.GUARD_ENTRY;
if (guardEntry) {
  registerRemoteOnce("badreact", guardEntry);
  await initializeShareScope();
  try {
    const mod = await loadRemote("badreact/routeConfig", { from: "build" });
    if (mod) {
      console.error("[server] GUARD PROBE FAILED — mismatched-version remote LOADED; strict shared guard did not fire");
      process.exit(1);
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (!/version|strict|19\.3\.0|requiredVersion/i.test(msg)) {
      console.error(`[server] GUARD PROBE FAILED — rejected for the WRONG reason (must be a version signature): ${msg.slice(0, 160)}`);
      process.exit(1);
    }
    console.log(`[server] guard probe passed — mismatched remote rejected: ${msg.slice(0, 120)}`);
  }
}

const WEB_ROOT =
  process.env.HOST_WEB_ROOT ??
  [
    path.join(process.cwd(), "dist-web"),
    path.join(process.cwd(), "host", "dist-web"),
    path.join(process.cwd(), "dist", "web"),
    path.join(process.cwd(), "host", "dist", "web"),
  ].find((p) => existsSync(p)) ??
  path.join(process.cwd(), "dist-web");
console.log(`[server] client bundle root: ${WEB_ROOT}`);

const httpServer = createHttpServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname.startsWith("/__host/")) {
      try {
        const file = path.join(WEB_ROOT, url.pathname.replace("/__host/", ""));
        const body = readFileSync(file);
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end(body);
      } catch {
        console.warn(`[server] 404 ${url.pathname}`);
        res.writeHead(404);
        res.end("// not found");
      }
      return;
    }
    const response = await renderPath(url.pathname, tree, sessionForHttp(req));
    if (response.status >= 300 && response.status < 400) {
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end();
      return;
    }
    const html = await new Response(response.body).text();
    res.writeHead(response.status, { "content-type": "text/html" });
    res.end(shell(tree, appKey, html));
  } catch (err) {
    console.error(`[server] request error: ${(err as Error).message}`);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(`ssr error: ${(err as Error).message}`);
    } else {
      res.destroy();
    }
  }
});

httpServer.listen(port, async () => {
  try {
    const [home, gated] = await Promise.all([
      fetch(`http://localhost:${port}/`, { redirect: "manual" }),
      fetch(`http://localhost:${port}/settings`, { redirect: "manual" }),
    ]);
    const ok = home.status === 200 && gated.status >= 300 && gated.status < 400;
    if (!ok) throw new Error(`self-probe failed: / ${home.status}, /settings ${gated.status}`);
    console.log(`[server] live self-probe passed — serving http://localhost:${port} — ^C to stop`);
  } catch (err) {
    console.error(`[server] LIVE SELF-PROBE FAILED: ${(err as Error).message} — unhealthy (ADR 0007 §2)`);
    process.exit(1);
  }
});

function sessionForHttp(req: IncomingHttpMessage): HostContext {
  return new URL(req.url ?? "/", `http://localhost:${port}`).searchParams.has("admin")
    ? { user: { id: "u1", name: "Ada", isAdmin: true } }
    : {};
}

type IncomingHttpMessage = { url?: string };
