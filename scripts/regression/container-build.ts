/**
 * Deployment dist build (ADR 0009): runs inside the `dist-builder`
 * stage. Builds every workspace the start-command stack serves — framework
 * auth provider, core ui (web + ssr, sequential environments), host dist,
 * api, and every local plugin from bos.config.json — then stages a
 * deterministic image layout plus both render-variant runtime configs.
 *
 * Generic by construction: child projects get this file via `bos sync` and
 * it derives everything from their own bos.config.json.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prepareLocalProductionConfig } from "../../packages/everything-dev/src/local-prod-config";

const root = process.cwd();
const imageDir = path.join(root, ".bos", "regression", "image");

const bosConfig = JSON.parse(readFileSync(path.join(root, "bos.config.json"), "utf8"));

const localPlugins = Object.entries(bosConfig.plugins ?? {})
  .filter(
    ([, ref]) =>
      typeof ref === "object" &&
      typeof ref.development === "string" &&
      ref.development.startsWith("local:"),
  )
  .map(([key, ref]) => [key, ref.development.slice("local:".length)] as const)
  .sort(([a], [b]) => a.localeCompare(b));

const run = (cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} in ${cwd} exited with ${result.status}`);
  }
};

const build = () => {
  console.log("[container-build] better-near-auth (production dist for prod-mode resolution)…");
  run("bun", ["run", "build"], "packages/better-near-auth");

  console.log("[container-build] core ui (web, then ssr — sequential environments)…");
  run("bun", ["run", "build:client"], "ui");
  run("bun", ["run", "build:ssr"], "ui");

  console.log("[container-build] host dist…");
  run("bun", ["run", "build"], "host", { BOS_CONFIG_PATH: path.join(root, "bos.config.json") });

  console.log("[container-build] api remote…");
  run("bun", ["run", "build"], "api");

  // app.auth is an app-slot, not a plugins.* entry — its workspace build
  // (`every-plugin build`) covers the api remote AND the folder-form ui.
  const authDevelopment = bosConfig.app?.auth?.development;
  if (typeof authDevelopment === "string" && authDevelopment.startsWith("local:")) {
    const authWorkspace = authDevelopment.slice("local:".length);
    console.log("[container-build] auth app-slot (api remote + folder-form ui)…");
    run("bun", ["run", "build"], authWorkspace);
  }

  for (const [key, workspace] of localPlugins) {
    console.log(`[container-build] plugin ${key} (api remote)…`);
    run("bun", ["run", "build"], workspace);
  }
};

// Fixed in-container port map — every service is container-local, so only the
// host port needs mapping at `docker run`.
const basePort = 4100;
const ports = {
  hostDist: basePort + 5,
  api: basePort + 1,
  auth: basePort + 2,
  ui: basePort + 3,
  authUi: basePort + 4,
};

const sanitizeContainerName = (pkgName: string): string => pkgName.replace(/[^A-Za-z0-9_]/g, "_");

const stage = () => {
  rmSync(imageDir, { recursive: true, force: true });
  mkdirSync(imageDir, { recursive: true });

  const dist = path.join(imageDir, "dist");
  const copyDist = (from: string, to: string) => {
    const source = path.join(root, from);
    if (!existsSync(source)) throw new Error(`expected build output missing: ${from}`);
    cpSync(source, path.join(dist, to), { recursive: true });
  };

  // app.auth is an app-slot, not a plugins.* entry — stage its api dist and
  // give it its server entry explicitly.
  const authDevelopment = bosConfig.app?.auth?.development;
  const authWorkspace =
    typeof authDevelopment === "string" && authDevelopment.startsWith("local:")
      ? authDevelopment.slice("local:".length)
      : null;

  copyDist("host/dist", "host");
  copyDist("ui/dist", "ui");
  copyDist("api/dist", "api");
  if (authWorkspace) {
    copyDist(path.join(authWorkspace, "dist"), path.join("plugins", "auth"));
  }
  copyDist("plugins/auth/ui/dist", "auth-ui");
  for (const [key, workspace] of localPlugins) {
    copyDist(path.join(workspace, "dist"), path.join("plugins", key));
  }

  // Namespace staging (plan 043): the same artifacts laid out at the exact
  // paths the /bundles/* FS route serves — bundles/<account>/<gateway>/<ws>/.
  // The prod image's runtime points BOS_BUNDLE_DIR here.
  const nsAccount = bosConfig.account;
  const nsGateway = bosConfig.domain;
  if (nsAccount && nsGateway) {
    const ns = path.join(root, ".bos", "bundles", nsAccount, nsGateway);
    rmSync(ns, { recursive: true, force: true });
    for (const [from, to] of [
      ["host/dist", "host"],
      ["ui/dist", "ui"],
      ["api/dist", "api"],
      ["plugins/auth/ui/dist", "auth-ui"],
      ...(authWorkspace ? [[path.join(authWorkspace, "dist"), "auth"] as const] : []),
      ...localPlugins.map(([key, workspace]) => [path.join(workspace, "dist"), key] as const),
    ]) {
      cpSync(path.join(root, from), path.join(ns, to), { recursive: true });
    }
  }

  // The auth ui must register under its BUILT container name (the sanitized
  // plugin package name) — the authored ui.name can never match it, and the
  // sources are gone by the time the runtime stage boots.
  const authPkgName = JSON.parse(
    readFileSync(path.join(root, "plugins", "auth", "package.json"), "utf8"),
  ).name as string;

  // Bundle slots are addressed at the namespace path shape, served by the
  // harness's own static servers (the host's /bundles/* route is gone —
  // ADR 0020). The production URL carries the base path; publicUrl is not
  // needed because the browser base is the same absolute URL.
  const nsBase = nsAccount && nsGateway ? `/bundles/${nsAccount}/${nsGateway}` : undefined;
  const slotUrl = (port: number, slot: string) =>
    nsBase ? `http://localhost:${port}${nsBase}/${slot}` : `http://localhost:${port}`;

  const plan = {
    host: `http://localhost:${ports.hostDist}`,
    ui: {
      production: slotUrl(ports.ui, "ui"),
    },
    api: `http://localhost:${ports.api}`,
    auth: slotUrl(ports.auth, "auth"),
    authUi: {
      production: slotUrl(ports.authUi, "auth-ui"),
      name: sanitizeContainerName(authPkgName),
    },
    plugins: Object.fromEntries(
      localPlugins.map(([key]) => {
        const port =
          key === "auth" ? ports.auth : basePort + 10 + localPlugins.findIndex(([k]) => k === key);
        return [
          key,
          {
            production: slotUrl(port, key),
          },
        ];
      }),
    ),
  };

  for (const variant of ["ssr", "csr"] as const) {
    const resolved = prepareLocalProductionConfig(bosConfig, {
      ...plan,
      ui: {
        ...plan.ui,
        ...(variant === "ssr" ? { ssr: `${plan.ui.production}/ssr` } : {}),
      },
      authUi: {
        ...plan.authUi,
        ...(variant === "ssr" ? { ssr: `${plan.authUi.production}/ssr` } : {}),
      },
    });
    // The auth plugin's reachable origin is environment truth, not fixture
    // data: the harness injects BASE_URL/CORS_ORIGIN at `docker run`
    // (start-container.mjs), the deployment image derives it from the bos
    // config domain — the host's buildAuthBaseVariables owns the precedence.
    writeFileSync(
      path.join(imageDir, `config-${variant}.json`),
      `${JSON.stringify(resolved, null, 2)}\n`,
    );
  }

  const servers: Array<{ dir: string; port: number; basePath?: string }> = [
    { dir: "dist/host", port: ports.hostDist },
    { dir: "dist/ui", port: ports.ui, ...(nsBase ? { basePath: `${nsBase}/ui` } : {}) },
    { dir: "dist/api", port: ports.api },
    {
      dir: "dist/auth-ui",
      port: ports.authUi,
      ...(nsBase ? { basePath: `${nsBase}/auth-ui` } : {}),
    },
  ];
  if (authWorkspace) {
    servers.push({
      dir: "dist/plugins/auth",
      port: ports.auth,
      ...(nsBase ? { basePath: `${nsBase}/auth` } : {}),
    });
  }
  for (const [key] of localPlugins) {
    if (key === "auth") continue;
    servers.push({
      dir: `dist/plugins/${key}`,
      port: basePort + 10 + localPlugins.findIndex(([k]) => k === key),
      ...(nsBase ? { basePath: `${nsBase}/${key}` } : {}),
    });
  }
  writeFileSync(
    path.join(imageDir, "layout.json"),
    `${JSON.stringify({ basePort, servers, configs: { ssr: "config-ssr.json", csr: "config-csr.json" } }, null, 2)}\n`,
  );

  console.log(`[container-build] staged image layout at ${path.relative(root, imageDir)}`);
};

// main
build();
stage();
