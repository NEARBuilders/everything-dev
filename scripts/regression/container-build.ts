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
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { containerName } from "every-plugin/identity";
import { composeVersionManifest } from "every-plugin/version-manifest";
import { writeResolvedConfig } from "../../packages/everything-dev/src/config";
import { openResolution } from "../../packages/everything-dev/src/resolution/session";

/**
 * Local production fixture rewriting (ADR 0009): a section named in the plan
 * has its production origin rewritten (when given) and its ssr URL set (when
 * given) or dropped; its integrity fields are dropped, because hashes bind an
 * artifact to a deployment and local artifacts change every build. Sections
 * absent from the plan stay verbatim.
 */
interface SlotPin {
  manifest: string;
  integrity: string;
}

interface OriginPlan {
  host?: string;
  hostPin?: SlotPin;
  ui?: { production?: string; ssr?: string; name?: string; publicUrl?: string; pin?: SlotPin };
  api?: string;
  apiPin?: SlotPin;
  auth?: string;
  authPin?: SlotPin;
  authUi?: { production?: string; ssr?: string; name?: string; publicUrl?: string; pin?: SlotPin };
  plugins?: Record<
    string,
    {
      production?: string;
      ui?: string;
      uiName?: string;
      uiPublicUrl?: string;
      pin?: SlotPin;
      uiPin?: SlotPin;
    }
  >;
}

type ConfigSection = Record<string, unknown> & {
  integrity?: string;
  ssrIntegrity?: string;
};

function stripIntegrity<T extends ConfigSection>(section: T): T {
  const next = { ...section };
  delete next.integrity;
  delete next.ssrIntegrity;
  return next;
}

function rewriteUi<
  T extends { production?: string; ssr?: string; name?: string; publicUrl?: string },
>(
  ui: T,
  planned:
    | {
        production?: string;
        ssr?: string;
        name?: string;
        publicUrl?: string;
        pin?: SlotPin;
      }
    | undefined,
): T {
  if (!planned) return ui;
  const next = stripIntegrity(ui);
  if (planned.production !== undefined) {
    next.production = planned.production;
  }
  if (planned.ssr !== undefined) {
    next.ssr = planned.ssr;
  } else {
    delete next.ssr;
  }
  if (planned.name !== undefined) {
    next.name = planned.name;
  }
  if (planned.publicUrl !== undefined) {
    next.publicUrl = planned.publicUrl;
  }
  if (planned.pin !== undefined) {
    (next as Record<string, unknown>).pin = planned.pin;
  }
  return next;
}

function rewritePluginRef(
  plugin: Record<string, unknown>,
  planned:
    | {
        production?: string;
        ui?: string;
        uiName?: string;
        uiPublicUrl?: string;
        pin?: SlotPin;
        uiPin?: SlotPin;
      }
    | undefined,
): Record<string, unknown> {
  if (!planned) return plugin;
  const next = {
    ...stripIntegrity(
      planned.production !== undefined ? { ...plugin, production: planned.production } : plugin,
    ),
  } as Record<string, unknown>;
  if (planned.pin !== undefined) {
    next.pin = planned.pin;
  }
  if (next.ui) {
    next.ui = rewriteUi(
      { ...(next.ui as Record<string, unknown>) },
      {
        ...(planned.ui ? { production: planned.ui } : {}),
        ...(planned.uiName ? { name: planned.uiName } : {}),
        ...(planned.uiPublicUrl ? { publicUrl: planned.uiPublicUrl } : {}),
        ...(planned.uiPin ? { pin: planned.uiPin } : {}),
      },
    );
  }
  return next;
}

function prepareLocalProductionConfig(
  config: Record<string, unknown> & { app?: Record<string, unknown>; plugins?: unknown },
  plan: OriginPlan,
): Record<string, unknown> {
  const app = { ...config.app } as Record<string, unknown>;

  if (app.host && plan.host !== undefined) {
    app.host = {
      ...(app.host as Record<string, unknown>),
      production: plan.host,
      ...(plan.hostPin ? { pin: plan.hostPin } : {}),
    };
  }

  if (app.ui) {
    app.ui = rewriteUi(app.ui as Record<string, unknown>, plan.ui);
  }

  if (app.api && plan.api !== undefined) {
    app.api = {
      ...stripIntegrity({ ...(app.api as Record<string, unknown>), production: plan.api }),
      ...(plan.apiPin ? { pin: plan.apiPin } : {}),
    };
  }

  if (app.auth) {
    let auth =
      plan.auth !== undefined
        ? {
            ...stripIntegrity({
              ...(app.auth as Record<string, unknown>),
              production: plan.auth,
            }),
            ...(plan.authPin ? { pin: plan.authPin } : {}),
          }
        : app.auth;
    const authRef = auth as Record<string, unknown>;
    if (authRef.ui) {
      auth = { ...authRef, ui: rewriteUi(authRef.ui as Record<string, unknown>, plan.authUi) };
    }
    app.auth = auth;
  }

  let plugins = config.plugins;
  if (plugins && plan.plugins) {
    const next: Record<string, unknown> = {};
    for (const [key, plugin] of Object.entries(plugins)) {
      if (typeof plugin === "string") {
        next[key] = plugin;
        continue;
      }
      next[key] = rewritePluginRef(plugin as Record<string, unknown>, plan.plugins[key]);
    }
    plugins = next;
  }

  return { ...config, app, ...(plugins ? { plugins } : {}) };
}

const root = process.cwd();
const imageDir = path.join(root, ".bos", "regression", "image");

// The v2 config model has no root bos.config.json — resolve the authored
// descriptor (bos.app.ts) in-process and write the generated resolved config
// the Dockerfile bakes into the image. Development resolution mirrors the
// old source of truth (the config `bos dev` wrote); the fixture rewriting
// below pins the production slot shapes.
const resolutionEnv = "development";
const session = await openResolution({ cwd: root, env: resolutionEnv });
if (!session?.config) {
  throw new Error("[container-build] config resolution returned no config");
}
const bosConfig = session.config;
const resolvedConfigPath = path.join(root, ".bos", "bos.resolved-config.json");
writeResolvedConfig(root, bosConfig, resolutionEnv, [...session.chain]);

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
  run("bun", ["run", "build"], "host", { BOS_CONFIG_PATH: resolvedConfigPath });

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

const sri384 = (bytes: string | Uint8Array): string =>
  `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

function readBuildReport(
  distDir: string,
): { entry: string; browserManifest?: string; css?: string } | null {
  const reportPath = path.join(root, distDir, "build-report.json");
  if (!existsSync(reportPath)) return null;
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { entry?: string };
    if (typeof report.entry !== "string" || !report.entry) return null;
    return report as { entry: string; browserManifest?: string; css?: string };
  } catch {
    return null;
  }
}

/**
 * The fixture pins every slot it serves (ADR 0009 amendment: version-manifest
 * pins are the only production slot shape). Composes the workspace's version
 * manifest from its dist build reports + locally-computed SRI — the staged
 * static servers ARE the storage boundary here — writes it at
 * `versions/<version>.json` inside the dist (both the image copy and the
 * BOS_BUNDLE_DIR namespace copy carry it), and returns the slot's `pin`.
 */
function pinDist(distDir: string, ssrDistDir?: string): SlotPin {
  const report = readBuildReport(distDir);
  if (!report) {
    throw new Error(
      `[container-build] ${distDir} has no build-report.json — the fixture pins every ` +
        `remote slot (atomic-deploys hard break); rebuild the workspace`,
    );
  }
  const ssrReport = ssrDistDir ? readBuildReport(ssrDistDir) : null;
  const manifest = composeVersionManifest({
    builtAt: new Date().toISOString(),
    entry: report.entry,
    entryIntegrity: sri384(readFileSync(path.join(root, distDir, report.entry))),
    ...(ssrReport
      ? {
          ssr: {
            entry: `ssr/${ssrReport.entry}`,
            integrity: sri384(readFileSync(path.join(root, ssrDistDir!, ssrReport.entry))),
          },
        }
      : {}),
    ...(report.browserManifest
      ? {
          browserManifest: {
            file: report.browserManifest,
            integrity: sri384(readFileSync(path.join(root, distDir, report.browserManifest))),
          },
        }
      : {}),
    ...(report.css
      ? { assets: { css: sri384(readFileSync(path.join(root, distDir, report.css))) } }
      : {}),
  });
  const manifestFile = `versions/${manifest.version}.json`;
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  mkdirSync(path.join(root, distDir, "versions"), { recursive: true });
  writeFileSync(path.join(root, distDir, manifestFile), body);
  return { manifest: manifestFile, integrity: sri384(body) };
}

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

  // Slot pins are composed FIRST, from the repo dist dirs, so both the image
  // copy and the namespace copy carry the version manifests.
  const pins: Record<string, SlotPin> = {
    host: pinDist("host/dist"),
    ui: pinDist("ui/dist", "ui/dist/ssr"),
    api: pinDist("api/dist"),
    ...(authWorkspace
      ? {
          auth: pinDist(path.join(authWorkspace, "dist")),
          // The auth ui ships an SSR entry (the ssr fixture variant composes
          // it) — pin it like the core ui so ssrEntryUrl derives.
          authUi: pinDist("plugins/auth/ui/dist", "plugins/auth/ui/dist/ssr"),
        }
      : {}),
    ...Object.fromEntries(
      localPlugins.map(([key, workspace]) => [key, pinDist(path.join(workspace, "dist"))]),
    ),
  };

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
    hostPin: pins.host,
    ui: {
      production: slotUrl(ports.ui, "ui"),
      pin: pins.ui,
    },
    api: `http://localhost:${ports.api}`,
    apiPin: pins.api,
    auth: slotUrl(ports.auth, "auth"),
    authPin: pins.auth,
    authUi: {
      production: slotUrl(ports.authUi, "auth-ui"),
      name: containerName(authPkgName),
      pin: pins.authUi,
    },
    plugins: Object.fromEntries(
      localPlugins.map(([key]) => {
        const port =
          key === "auth" ? ports.auth : basePort + 10 + localPlugins.findIndex(([k]) => k === key);
        return [
          key,
          {
            production: slotUrl(port, key),
            pin: pins[key],
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
