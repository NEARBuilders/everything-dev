import { resolveApp, resolveSource, parseBosRef } from "./resolver";
import type { ResolveContext } from "./resolver";
import { apps } from "./configs";
import { runChecks } from "./verify-helpers";

const REMOTE_NAMES: Record<string, string> = {
  "remote-dashboard-api": "remote_dashboard_api",
  "remote-dashboard-ui": "remote_dashboard_ui",
  "remote-landing": "remote_landing",
  "remote-tenant-dashboard-ui": "remote_tenant_dashboard_ui",
};

const PORTS: Record<string, number> = {
  "remote-dashboard-api": 3101,
  "remote-dashboard-ui": 3102,
  "remote-landing": 3103,
  "remote-tenant-dashboard-ui": 3104,
};

function devContext(): ResolveContext {
  return {
    mode: "development",
    configDir: ".",
    portMap: new Map(Object.entries(PORTS)),
    nameOf: (path) => REMOTE_NAMES[path] ?? path.split("/").filter(Boolean).join("-"),
  };
}

async function main() {
  const checks: Array<[boolean, string]> = [];

  const base = await resolveApp(apps.base, devContext());
  const tenant = await resolveApp(apps.tenant, devContext());

  const uiUrl = (ns: string, app: typeof base) => app.ui.find((u) => u.ns === ns)?.url;
  const apiByNs = (ns: string, app: typeof base) => app.api.find((a) => a.ns === ns);

  checks.push(
    [base.api.length === 1 && base.api[0].ns === "dashboard", "base resolves 1 API namespace (dashboard)"],
    [base.ui.length === 2, "base resolves 2 UI namespaces (dashboard, landing)"],
    [apiByNs("dashboard", base)!.url === "http://localhost:3101", "local://dashboard api → port 3101"],
    [apiByNs("dashboard", base)!.entry === "http://localhost:3101/mf-manifest.json", "entry = url + /mf-manifest.json"],
    [apiByNs("dashboard", base)!.name === "remote_dashboard_api", "remote name from static nameOf map"],
    [uiUrl("dashboard", base) === "http://localhost:3102", "local://dashboard ui → port 3102"],
    [uiUrl("landing", base) === "http://localhost:3103", "local://landing (ui-only) → port 3103"],
    [apiByNs("dashboard", tenant)!.url === "http://localhost:3101" && apiByNs("dashboard", tenant)!.name === "remote_dashboard_api", "tenant inherits SAME dashboard api"],
    [uiUrl("dashboard", tenant) === "http://localhost:3104", "tenant overrides dashboard UI → tenant remote port"],
    [uiUrl("landing", tenant) === "http://localhost:3103", "tenant inherits landing UI unchanged"],
  );

  const prodCtx: ResolveContext = {
    mode: "production",
    configDir: ".",
    deployMap: new Map([
      ["remote-dashboard-api", { url: "https://api-abc.zephyr.app", integrity: "sha384-aaa" }],
      ["remote-dashboard-ui", { url: "https://ui-def.zephyr.app", integrity: "sha384-bbb" }],
      ["remote-landing", { url: "https://landing-ghi.zephyr.app", integrity: "sha384-ccc" }],
    ]),
    nameOf: (path) => REMOTE_NAMES[path] ?? path.split("/").filter(Boolean).join("-"),
  };
  const prodBase = await resolveApp(apps.base, prodCtx);
  const prodUi = (ns: string) => prodBase.ui.find((u) => u.ns === ns)?.url;
  checks.push(
    [prodBase.api[0].url === "https://api-abc.zephyr.app", "prod: local:// → CDN url from deployMap"],
    [prodBase.api[0].integrity === "sha384-aaa", "prod: integrity captured from deploy record"],
    [prodUi("dashboard") === "https://ui-def.zephyr.app", "prod: dashboard UI → CDN url"],
    [prodUi("landing") === "https://landing-ghi.zephyr.app", "prod: landing UI → CDN url"],
  );

  const bosCtx: ResolveContext = {
    mode: "production",
    configDir: ".",
    extendsResolver: async (ref) =>
      ref === "bos://auth.near/auth.dev#app.auth"
        ? { name: "remote_auth", url: "https://auth.zephyr.app", entry: "https://auth.zephyr.app/mf-manifest.json" }
        : null,
    nameOf: (p) => p,
  };
  const bosModule = await resolveSource("bos://auth.near/auth.dev#app.auth", bosCtx);
  checks.push(
    [bosModule.url === "https://auth.zephyr.app", "bos:// ref resolved via extendsResolver strategy"],
    [bosModule.name === "remote_auth", "bos:// resolved module carries its own name"],
  );

  const parseCheck = parseBosRef(
    "bos://dev.everything.near/dev.everything.dev#app.auth",
  );
  checks.push(
    [parseCheck.account === "dev.everything.near", "parseBosRef extracts account"],
    [parseCheck.domain === "dev.everything.dev", "parseBosRef extracts domain"],
    [parseCheck.fieldPath === "app.auth", "parseBosRef extracts #field.path"],
  );

  runChecks("RESOLVER — source URIs → concrete URLs", checks);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});