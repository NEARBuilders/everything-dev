import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Effect } from "effect";
import sirv from "sirv";
import { DEV_ENTRY_FILENAME } from "../build/artifact-names";
import { ensureGeneratedRspackConfig } from "../build/rspack/generated-config";
import { getPluginInfo, loadDevConfig } from "../build/rspack/utils";
import { ensureGeneratedUiRsbuildConfig, pluginLayoutKey } from "../build/ui/generated-config";
import { PLUGIN_ERROR_STATUS_MAP } from "../errors";
import { loadRemoteWithRetry } from "../remote-entry";
import { startDirectModuleHost } from "./host";
import { killChildEscalating, watchParentDeath } from "./watch-kill";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
};

const applyCorsHeaders = (res: http.ServerResponse) => {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
};

const normalizePrefix = (prefix?: string): string => {
  if (!prefix) return "";
  const cleaned = prefix.replace(/^\/+|\/+$/g, "");
  return cleaned ? `/${cleaned}` : "";
};

const readRuntimeConfigFromEnv = (): any => {
  const raw = process.env.BOS_RUNTIME_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const collectSiblingRemotes = (runtimeConfig: any, pluginId: string) => {
  const siblings: Record<string, { remote: string }> = {};

  const isApi = pluginId === "api" || runtimeConfig?.api?.name === pluginId;

  const ownKey = runtimeConfig?.plugins?.[pluginId] ? pluginId : null;
  let dependsOn: string[] = [];
  if (ownKey) {
    dependsOn = runtimeConfig.plugins[ownKey].dependsOn ?? [];
  } else if (isApi) {
    dependsOn = runtimeConfig?.api?.dependsOn ?? [];
  }

  for (const depId of dependsOn) {
    const dep = runtimeConfig?.plugins?.[depId];
    if (!dep || dep.source !== "local" || !dep.url) continue;
    if (depId === pluginId) continue;
    const base = dep.url.replace(/\/$/, "");
    siblings[depId] = { remote: `${base}/${DEV_ENTRY_FILENAME}` };
  }

  return { siblings, dependsOn };
};

const loadPluginWithRetry = (
  runtime: any,
  pluginId: string,
  remoteUrl: string,
  options: Record<string, unknown> = { variables: {}, secrets: {} },
  pluginsMap?: Record<string, unknown>,
  timeoutMs = 90000,
): Promise<any> =>
  Effect.runPromise(
    loadRemoteWithRetry({
      label: pluginId,
      remoteUrl,
      load: () => runtime.usePlugin(pluginId, options, pluginsMap),
      timeoutMs,
    }),
  );

const sendText = (res: http.ServerResponse, status: number, text: string) => {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(text);
};

export interface PluginDevServeOptions {
  cwd?: string;
  port?: number;
  watch?: boolean;
}

export interface PluginDevServerHandle {
  port: number;
  close: () => Promise<void>;
}

/**
 * The dev server's plugin id — the workspace's npm package name, the same
 * value the host passes as `runtimeId`. Both initialize sites must agree:
 * `registerRemote` derives the MF remote name from it, and the plugin's
 * database layer derives its migration slug from it, so a pre-normalized
 * remote name here would migrate into a different schema than the host
 * expects. plugin.dev.ts no longer carries a pluginId field.
 */
export const resolveDevPluginId = (cwd: string): string => getPluginInfo(cwd).name;

export async function startPluginDevServer(
  options: PluginDevServeOptions = {},
): Promise<PluginDevServerHandle> {
  process.env.BOS_DEV_SERVER = "1";
  const cwd = options.cwd ?? process.cwd();
  const pluginInfo = getPluginInfo(cwd);
  const devConfig = loadDevConfig(path.join(cwd, "plugin.dev.ts"));
  const pluginId = resolveDevPluginId(cwd);
  const compositionKey = pluginLayoutKey(cwd) ?? pluginId;
  const port = options.port ?? (Number(process.env.PORT) || devConfig?.port || 3999);
  const rpcPrefix = normalizePrefix(devConfig?.prefix);

  const distDir = path.join(cwd, "dist");
  const serveStatic = sirv(distDir, { dev: true });

  // No-watch mode (BOS_NO_WATCH=1): build once, serve the built output.
  // Regression/CI stacks need no hot reload — watchers are the stack's
  // heaviest processes and stall runs freeze under their accumulated
  // footprint. One-shot builds exit; steady state is small static servers.
  const noWatch = options.watch === false || process.env.BOS_NO_WATCH === "1";

  const runOnce = (cmd: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`❌ ${cmd} ${args.join(" ")} exited with ${code}`));
      });
    });

  let watcher: ReturnType<typeof spawn> | null = null;
  if (noWatch) {
    const generatedConfig = ensureGeneratedRspackConfig(cwd);
    await runOnce("rspack", generatedConfig ? ["build", "--config", generatedConfig] : ["build"]);
  } else if (options.watch !== false) {
    const generatedConfig = ensureGeneratedRspackConfig(cwd);
    watcher = spawn(
      "rspack",
      generatedConfig ? ["build", "--watch", "--config", generatedConfig] : ["build", "--watch"],
      {
        cwd,
        stdio: "inherit",
        env: process.env,
      },
    );
    watcher.on("error", (error) => {
      console.error(`❌ Failed to spawn rspack build --watch: ${error.message}`);
    });
  }

  let uiWatcher: ReturnType<typeof spawn> | null = null;
  let uiStaticServer: http.Server | null = null;
  const uiPort = process.env.BOS_UI_PORT;
  const uiConfig = ensureGeneratedUiRsbuildConfig(cwd);
  if (uiConfig && noWatch && uiPort) {
    // Folder-form ui: one-shot build, then serve the ui source root's dist
    // (the factory's absolute distPath target) statically on the ui port.
    await runOnce("rsbuild", ["build", "--config", uiConfig]);
    const uiDistDir =
      path.basename(cwd) === "ui" ? path.join(cwd, "dist") : path.join(cwd, "ui", "dist");
    if (!fs.existsSync(path.join(uiDistDir, DEV_ENTRY_FILENAME))) {
      console.error(
        `❌ UI dist is missing at ${uiDistDir} — the ui static server would serve 404s for every asset (build output layout mismatch?)`,
      );
    }
    const serveUiStatic = sirv(uiDistDir, { dev: true });
    uiStaticServer = http.createServer((req, res) => {
      applyCorsHeaders(res);
      serveUiStatic(req, res, () => {
        sendText(res, 404, "Not Found");
      });
    });
    await new Promise<void>((resolve, reject) => {
      uiStaticServer!.once("error", reject);
      uiStaticServer!.listen(Number(uiPort), () => resolve());
    });
    console.log(`├─ 🎨 UI:     http://localhost:${uiPort} (built, no watch)`);
  } else if (uiConfig) {
    uiWatcher = spawn("rsbuild", ["dev", "--config", uiConfig], {
      cwd,
      stdio: "inherit",
      env: uiPort ? { ...process.env, PORT: uiPort } : process.env,
    });
    uiWatcher.on("error", (error) => {
      console.error(`❌ Failed to spawn rsbuild ui dev: ${error.message}`);
    });
    console.log(`├─ 🎨 UI:     ${uiPort ? `http://localhost:${uiPort}` : "(rsbuild auto port)"}`);
  }

  const handlers: { rpc: any; api: any } = { rpc: null, api: null };
  const effectContextHolder: { context: unknown } = { context: null };
  let runtime: { shutdown: () => Promise<void> } | null = null;
  const host = await startDirectModuleHost({
    name: pluginInfo.normalizedName,
    version: pluginInfo.version,
    handlers,
    effectContext: () => effectContextHolder.context,
    port,
    staticHandler: serveStatic,
  });

  console.log(`🚀 ${pluginInfo.name} dev server listening on port ${host.port}`);
  console.log(`├─ 📡 RPC:    http://localhost:${host.port}/api/rpc${rpcPrefix}`);
  console.log(`├─ 📖 Docs:   http://localhost:${host.port}/api`);
  console.log(`└─ 💚 Health: http://localhost:${host.port}/`);

  const load = async () => {
    try {
      // Import framework internals directly. A package self-import can resolve
      // the published entry while this source-first dev server is running,
      // which leaves the runtime exports unavailable on Windows.
      const { createPluginRuntime } = await import("../runtime");
      const { RPCHandler } = await import("@orpc/server/fetch");
      const { OpenAPIHandler } = await import("@orpc/openapi/fetch");
      const { OpenAPIGenerator } = await import("@orpc/openapi");
      const { OpenAPIReferenceHandlerPlugin } = await import("@orpc/openapi/plugins");
      const { ZodToJsonSchemaConverter } = await import("@orpc/zod");
      const { onError } = await import("@orpc/server");
      const { formatORPCError } = await import("../errors");

      const runtimeConfig = readRuntimeConfigFromEnv();
      const { siblings, dependsOn } = collectSiblingRemotes(runtimeConfig, compositionKey);

      if (dependsOn.length > 0) {
        console.log(`🔗 Loading sibling plugin(s): ${dependsOn.join(", ")}`);
      }

      const registry: Record<string, { remote: string }> = {
        [pluginId]: {
          remote: `http://localhost:${host.port}/${DEV_ENTRY_FILENAME}`,
        },
        ...siblings,
      };

      const mfRuntime = createPluginRuntime({ registry });
      runtime = mfRuntime;

      const pluginsMap: Record<string, unknown> = {};
      const siblingEffectContexts: unknown[] = [];
      for (const depId of Object.keys(siblings)) {
        const dep = await loadPluginWithRetry(mfRuntime, depId, siblings[depId]!.remote);
        pluginsMap[depId] = { client: dep.createClient, router: dep.router };
        if (dep.initialized?.effectContext) {
          siblingEffectContexts.push(dep.initialized.effectContext);
        }
        console.log(`✅ Loaded dependency plugin: ${depId}`);
      }

      const loaded: any = await loadPluginWithRetry(
        mfRuntime,
        pluginId,
        registry[pluginId]!.remote,
        (devConfig?.config ?? { variables: {}, secrets: {} }) as Record<string, unknown>,
        Object.keys(pluginsMap).length > 0 ? pluginsMap : undefined,
      );

      const { Context } = await import("effect");
      effectContextHolder.context = [loaded.initialized?.effectContext, ...siblingEffectContexts]
        .filter(Boolean)
        .reduce((acc: any, ctx: any) => Context.merge(acc, ctx), Context.empty());

      handlers.rpc = new RPCHandler(loaded.router, {
        errorStatusMap: PLUGIN_ERROR_STATUS_MAP,
        interceptors: [
          onError((error: any) => {
            const formatted = formatORPCError(error);
            if (formatted) console.error(formatted);
          }),
        ],
      });

      const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] });

      handlers.api = new OpenAPIHandler(loaded.router, {
        errorStatusMap: PLUGIN_ERROR_STATUS_MAP,
        plugins: [
          new OpenAPIReferenceHandlerPlugin({
            spec: () => generator.generate(loaded.router, { version: "3.1.1" }),
          }),
        ],
        interceptors: [
          onError((error: any) => {
            const formatted = formatORPCError(error);
            if (formatted) console.error(formatted);
          }),
        ],
      });

      console.log(`✅ Plugin ready: ${pluginId}`);
    } catch (error) {
      console.error(`❌ Failed to load plugin ${pluginId}:`, error);
      console.error("   Server stays up; fix the build and retry via rebuild.");
    }
  };

  void load();

  const close = async () => {
    handlers.rpc = null;
    handlers.api = null;
    effectContextHolder.context = null;
    for (const child of [watcher, uiWatcher]) {
      if (child) {
        await killChildEscalating(child);
      }
    }
    if (uiStaticServer) {
      await new Promise<void>((resolve) => uiStaticServer.close(() => resolve()));
    }
    await host.close();
    if (runtime) await runtime.shutdown().catch(() => {});
  };

  process.once("SIGINT", async () => {
    const timeout = setTimeout(() => process.exit(0), 3000);
    await close();
    clearTimeout(timeout);
    process.exit(0);
  });
  process.once("SIGTERM", async () => {
    const timeout = setTimeout(() => process.exit(0), 3000);
    await close();
    clearTimeout(timeout);
    process.exit(0);
  });

  watchParentDeath(async () => {
    const timeout = setTimeout(() => process.exit(0), 3000);
    await close();
    clearTimeout(timeout);
    process.exit(0);
  });

  return { port, close };
}

const invokedAsCli = import.meta.main || (process.argv[1] ?? "").includes("every-plugin-serve");

if (invokedAsCli) {
  startPluginDevServer().catch((error) => {
    console.error("❌ Plugin dev server fatal error:", error);
    process.exit(1);
  });
}
