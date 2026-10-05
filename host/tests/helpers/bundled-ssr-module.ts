import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createInstance } from "@module-federation/enhanced/runtime";
import { setGlobalFederationInstance } from "@module-federation/runtime-core";
import { patchManifestFetchForSsrPublicPath } from "everything-dev/mf";
import type { RouterModule } from "../../src/types";
import { type StaticDistServer, startStaticDistServer } from "./static-dist-server";
import { loadHostTestEnv } from "./test-env";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const uiDir = path.join(workspaceRoot, "ui");
let buildReady = false;

loadHostTestEnv(workspaceRoot);

/** The hashed SSR entry name from the ssr dist's build report — the fixed
 * names were retired (atomic-deploys); the report is the discovery contract. */
function ssrServerEntry(): string {
  const reportPath = path.join(uiDir, "dist", "ssr", "build-report.json");
  if (!existsSync(reportPath)) return "";
  try {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { entry?: string };
    const entry = typeof report.entry === "string" ? report.entry : "";
    return entry && existsSync(path.join(uiDir, "dist", "ssr", entry)) ? entry : "";
  } catch {
    return "";
  }
}

function ensureUiServerBuild() {
  if (buildReady) return;

  if (ssrServerEntry()) {
    buildReady = true;
    return;
  }

  // parallel vitest workers race here: only one may run the ui build — the
  // others wait for the winner's output (rsbuild wipes dist, so a losing
  // concurrent build both slows every worker and can serve a half-built dist)
  const lockDir = path.join(uiDir, "dist", ".ssr-build-lock");
  let locked = false;
  try {
    mkdirSync(path.join(uiDir, "dist"), { recursive: true });
    mkdirSync(lockDir);
    locked = true;
  } catch {
    // someone else is building — wait for their output (up to 90s)
    const deadline = Date.now() + 90_000;
    while (!ssrServerEntry() && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ssrServerEntry()) {
      rmSync(lockDir, { recursive: true, force: true });
      locked = mkdirSyncSafe(lockDir);
    }
  }

  try {
    const result = spawnSync("pnpm", ["run", "build"], {
      cwd: uiDir,
      stdio: "inherit",
      env: { ...process.env, BUILD_TARGET: "server" },
    });

    if (result.status !== 0) {
      throw new Error(`UI server build failed (exit ${result.status ?? "unknown"})`);
    }
  } finally {
    if (locked) rmSync(lockDir, { recursive: true, force: true });
  }

  buildReady = true;
}

function mkdirSyncSafe(dir: string): boolean {
  try {
    mkdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

let activeSsrLoader: {
  uiServer: StaticDistServer;
  mf: ReturnType<typeof createInstance>;
} | null = null;

export async function loadBundledRouterModule(): Promise<{
  routerModule: RouterModule;
  assetsUrl: string;
  cleanup: () => Promise<void>;
}> {
  ensureUiServerBuild();

  if (activeSsrLoader) {
    const mod = await (activeSsrLoader.mf as any).loadRemote("ui/Router", { from: "build" });
    return {
      routerModule: mod.default as RouterModule,
      assetsUrl: activeSsrLoader.uiServer.baseUrl,
      cleanup: async () => {},
    };
  }

  const uiServer = await startStaticDistServer(path.join(uiDir, "dist"));

  const mf = createInstance({
    name: "ssr-test-host",
    remotes: [
      {
        name: "ui",
        entry: `${uiServer.baseUrl}/ssr/mf-manifest.json`,
        alias: "ui",
      },
    ],
  });
  setGlobalFederationInstance(mf as any);
  patchManifestFetchForSsrPublicPath(mf as any);

  const mod = await (mf as any).loadRemote("ui/Router", { from: "build" });
  if (!mod?.default) {
    await uiServer.stop();
    throw new Error("Bundled UI remote did not export Router module");
  }

  activeSsrLoader = { uiServer, mf };

  return {
    routerModule: mod.default as RouterModule,
    assetsUrl: uiServer.baseUrl,
    cleanup: async () => {
      if (activeSsrLoader) {
        await activeSsrLoader.uiServer.stop();
        if ((mf as any).getInstance) {
          setGlobalFederationInstance(undefined as any);
        }
        activeSsrLoader = null;
      }
    },
  };
}
