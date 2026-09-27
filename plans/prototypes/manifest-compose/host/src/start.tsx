/**
 * start.ts — boot the app from the app.ts descriptor (plan 028's contract,
 * dev slice): import the descriptor → resolve (extends flattening) →
 * construct the tree from SOURCE manifests → serve SSR. Local refs only:
 * apps containing remote refs boot through the bundled server (node dist).
 *
 * usage: bun src/start.tsx [--app=base|tenant] [--port=3000]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constructTree, type ConstructedTree, type HostContext } from "./construct";
import { resolveAppOrThrow, diskResolver, renderPath } from "./harness";
import { APPS, type AppKey } from "../../apps";

const protoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

(globalThis as Record<string, unknown>).React = (await import("react")).default;

const arg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1]! : fallback;
};
const appKey = arg("app", "base") as AppKey;
const port = Number(arg("port", "3000"));

const app = resolveAppOrThrow(APPS, appKey);
if (Object.values(app.plugins).some((p) => p.source.kind === "remote")) {
  const remoteKeys = Object.values(app.plugins)
    .filter((p) => p.source.kind === "remote")
    .map((p) => p.key);
  console.error(
    `[start] app "${appKey}" deploys remote refs (${remoteKeys.join(", ")}) — boot the bundled server: bun run build:bundled && APP=${appKey} node dist/static/js/index.js`,
  );
  process.exit(1);
}

console.log(`[start] booting from apps.ts → app "${appKey}" (plugins: ${Object.keys(app.plugins).join(", ")})`);
const tree: ConstructedTree = await constructTree(app, diskResolver(protoRoot));
console.log(`[start] composed ${tree.manifests.length} plugin(s), digest=${tree.digest}`);

function sessionFor(req: Request): HostContext {
  return new URL(req.url).searchParams.has("admin")
    ? { user: { id: "u1", name: "Ada", isAdmin: true } }
    : {};
}

Bun.serve({
  port,
  async fetch(req) {
    const response = await renderPath(new URL(req.url).pathname, tree, sessionFor(req));
    if (response.status >= 300 && response.status < 400) {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const html = await new Response(response.body).text();
    const title = tree.headMetas.find((m) => m?.title)?.title ?? "app";
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`,
      { status: response.status, headers: { "content-type": "text/html" } },
    );
  },
});
console.log(`[start] serving http://localhost:${port} (digest=${tree.digest}) — ^C to stop`);
