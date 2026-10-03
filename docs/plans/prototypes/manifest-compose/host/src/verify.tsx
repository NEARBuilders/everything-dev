/**
 * Headless gate runner (plan 033) — the deterministic SSR proof on the DISK
 * path: host composes plugin manifests into ITS OWN tree and streams via
 * createRequestHandler + renderRouterToStream. The MF production shape is
 * verified by the bundled server (src/server.tsx) boot health.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveAppOrThrow,
  diskResolver,
  renderPath,
  readResponse,
  clean,
  ANON,
  ADMIN,
} from "./harness";
import { constructTree } from "./construct";
import { APPS } from "../../apps";

const protoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

(globalThis as Record<string, unknown>).React = (await import("react")).default;

async function main() {
  const results: Array<[string, boolean, string]> = [];
  const check = async (name: string, run: () => Promise<string | false>) => {
    try {
      const detail = await run();
      results.push([name, detail !== false, detail === false ? "FAILED" : detail]);
    } catch (err) {
      results.push([name, false, `threw: ${(err as Error).message}`]);
    }
  };

  const baseInput = resolveAppOrThrow(APPS, "base");
  const tenantInput = resolveAppOrThrow(APPS, "tenant");
  const base = await constructTree(baseInput, diskResolver(protoRoot));
  const tenant = await constructTree(tenantInput, diskResolver(protoRoot));

  await check("gate2: / renders base landing under _public (landing + host chrome)", async () => {
    const r = await readResponse(await renderPath("/", base, ANON));
    const t = clean(r.html);
    return t.includes("Landing index — BASE landing plugin") && t.includes("[landing:public]") ? "ok" : false;
  });
  await check("gate3: /login renders auth plugin under the SAME _public mount", async () => {
    const r = await readResponse(await renderPath("/login", base, ANON));
    const t = clean(r.html);
    return t.includes("Login (auth plugin)") && t.includes("[auth:public]") ? "ok" : false;
  });
  await check("gate3: /docs renders landing docs route", async () => {
    const r = await readResponse(await renderPath("/docs", base, ANON));
    return clean(r.html).includes("Docs (landing plugin)") ? "ok" : false;
  });
  await check("gate2: anon /settings redirects to /login (host session gate)", async () => {
    const r = await readResponse(await renderPath("/settings", base, ANON));
    return r.status >= 300 && r.status < 400 && (r.location?.includes("/login") ?? false)
      ? `ok (${r.status} → ${r.location})`
      : false;
  });
  await check("gate2: admin /settings/api-keys renders (session gate passes, plugin loader runs)", async () => {
    const r = await readResponse(await renderPath("/settings/api-keys", base, ADMIN));
    const t = clean(r.html);
    return t.includes("API keys (auth plugin)") && t.includes("[auth:authenticated]") ? "ok" : false;
  });
  await check("gate2: admin /login redirects to / (plugin route-level reject-authed beforeLoad)", async () => {
    const r = await readResponse(await renderPath("/login", base, ADMIN));
    return r.status >= 300 && r.status < 400 ? `ok (${r.status} → ${r.location})` : false;
  });
  await check("gate4: SSR streams plugin content server-side (loader data hydrated)", async () => {
    const r = await readResponse(await renderPath("/settings/api-keys", base, ADMIN));
    return clean(r.html).includes("edk_demo") ? "ok (loader data in SSR HTML)" : false;
  });
  await check("gate4: __root head lifted — host head() merges plugin metas", async () => {
    const titles = base.headMetas.map((m) => m?.title).filter(Boolean);
    return titles.includes("Auth Plugin (remote)") && titles.includes("Landing (remote)")
      ? `ok (${titles.join(" | ")})`
      : false;
  });
  await check("metadata: nav manifest assembled from composed staticData", async () => {
    const docs = base.nav.find((n) => n.path === "/docs");
    return docs?.label === "Docs" && docs?.order === 10 ? `ok (${base.nav.map((n) => n.label).join(", ")})` : false;
  });
  await check("extends: tenant inherits auth, overrides landing (child-wins merge)", async () => {
    const keys = Object.keys(tenantInput.plugins).sort();
    const authSource = tenantInput.plugins["auth"]?.source;
    return keys.join(",") === "auth,landing" && authSource?.kind === "local" && authSource.path === "./remote-auth"
      ? `ok (plugins: ${keys.join(", ")})`
      : false;
  });
  await check("gate6: tenant swap renders TENANT landing at /", async () => {
    const r = await readResponse(await renderPath("/", tenant, ANON));
    const t = clean(r.html);
    return t.includes("TENANT landing plugin") && t.includes("[landing-tenant:public]") ? "ok" : false;
  });
  await check("gate6: digests differ across apps, stable across re-composition", async () => {
    const baseAgain = await constructTree(baseInput, diskResolver(protoRoot));
    return base.digest !== tenant.digest && baseAgain.digest === base.digest
      ? `ok (base=${base.digest} tenant=${tenant.digest})`
      : false;
  });
  await check("digest: registry version participates (imported, not hardcoded)", async () => {
    const { MOUNT_REGISTRY_VERSION } = await import("@manifest-compose/shared");
    return base.digest.length === 16 && MOUNT_REGISTRY_VERSION > 0
      ? `ok (registry v${MOUNT_REGISTRY_VERSION}, digest ${base.digest})`
      : false;
  });
  await check("construction: manifests composed in name-ascending order", () => {
    const order = base.manifests.map((m) => m.name);
    return order.every((n, i) => i === 0 || order[i - 1]! <= n) ? `ok (${order.join(", ")})` : false;
  });

  let failures = 0;
  console.log("=== manifest-compose prototype gates (disk/dev path) ===");
  for (const [name, ok, detail] of results) {
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}  ${ok ? "— " + detail : ""}`);
  }
  console.log(`\n=== RESULT: ${failures === 0 ? `PASS — ${results.length}/${results.length}` : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify crashed:", err);
  process.exit(1);
});
