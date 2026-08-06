import type { PluginInfo } from "./utils";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
};

const applyCorsHeaders = (res: any) => {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
};

const normalizePrefix = (prefix?: string): string => {
  if (!prefix) return "";
  const cleaned = prefix.replace(/^\/+|\/+$/g, "");
  return cleaned ? `/${cleaned}` : "";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const isApi =
    pluginId === "api" || runtimeConfig?.api?.name === pluginId;

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
    siblings[depId] = { remote: `${base}/remoteEntry.js` };
  }

  return { siblings, dependsOn };
};

const loadPluginWithRetry = async (
  runtime: any,
  pluginId: string,
  timeoutMs = 90000,
): Promise<any> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await runtime.usePlugin(pluginId, { variables: {}, secrets: {} } as any);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw lastError;
};

export function setupPluginMiddleware(
  devServer: any,
  pluginInfo: PluginInfo,
  devConfig: any,
  port: number,
) {
  const rpcPrefix = normalizePrefix(devConfig?.prefix);
  const handlers: { rpc: any; api: any } = { rpc: null, api: null };
  let cleanup: (() => Promise<void>) | null = null;

  const performCleanup = async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  };

  (async () => {
    await performCleanup();

    try {
      const { createPluginRuntime } = await import("every-plugin");
      const { RPCHandler } = await import("@orpc/server/fetch");
      const { OpenAPIHandler } = await import("@orpc/openapi/fetch");
      const { OpenAPIReferencePlugin } = await import("@orpc/openapi/plugins");
      const { ZodToJsonSchemaConverter } = await import("@orpc/zod/zod4");
      const { onError } = await import("every-plugin/orpc");
      const { formatORPCError } = await import("every-plugin/errors");

      const pluginId = devConfig?.pluginId || pluginInfo.normalizedName;

      const runtimeConfig = readRuntimeConfigFromEnv();
      const { siblings, dependsOn } = collectSiblingRemotes(runtimeConfig, pluginId);

      if (dependsOn.length > 0) {
        console.log(
          `│  🔗 Loading sibling plugin(s) for ${pluginId}: ${dependsOn.join(", ")}`,
        );
      }

      const registry: Record<string, { remote: string }> = {
        [pluginId]: {
          remote: `http://localhost:${port}/remoteEntry.js`,
        },
        ...siblings,
      };

      const runtime = createPluginRuntime({
        registry,
      });

      const defaultConfig = { variables: {}, secrets: {} };

      const pluginsMap: Record<string, unknown> = {};
      for (const depId of Object.keys(siblings)) {
        const dep = await loadPluginWithRetry(runtime, depId);
        pluginsMap[depId] = dep.createClient;
        console.log(`│  ✅ Loaded dependency plugin: ${depId}`);
      }

      const loaded: any = await runtime.usePlugin<typeof pluginId>(
        pluginId,
        (devConfig?.config ?? defaultConfig) as any,
        Object.keys(pluginsMap).length > 0 ? pluginsMap : undefined,
      );

      cleanup = async () => {
        handlers.rpc = null;
        handlers.api = null;
        if (devServer.app.locals.handlers) {
          devServer.app.locals.handlers = null;
        }
        if (runtime) await runtime.shutdown();
      };

      handlers.rpc = new RPCHandler(loaded.router, {
        interceptors: [
          onError((error: any) => {
            const formatted = formatORPCError(error);
            if (formatted) console.error(formatted);
          }),
        ],
      });

      handlers.api = new OpenAPIHandler(loaded.router, {
        plugins: [
          new OpenAPIReferencePlugin({
            schemaConverters: [new ZodToJsonSchemaConverter()],
          }),
        ],
        interceptors: [
          onError((error: any) => {
            const formatted = formatORPCError(error);
            if (formatted) console.error(formatted);
          }),
        ],
      });

      console.log(`╭─────────────────────────────────────────────`);
      console.log(`│  ✅ Plugin dev server ready: `);
      console.log(`├─────────────────────────────────────────────`);
      console.log(`│  📡 RPC:    http://localhost:${port}/api/rpc${rpcPrefix}`);
      console.log(`│  📖 Docs:   http://localhost:${port}/api`);
      console.log(`│  💚 Health: http://localhost:${port}/`);
      console.log(`╰─────────────────────────────────────────────`);

      devServer.app.locals.handlers = handlers;

      if (devServer.server) {
        devServer.server.once("close", async () => {
          await performCleanup();
        });
      }
    } catch (error) {
      console.error("❌ Failed to load plugin:", error);
      await performCleanup();
    }
  })().catch((err) => {
    console.error("❌ Plugin dev server fatal error:", err);
  });

  process.once("SIGINT", async () => {
    const timeout = setTimeout(() => process.exit(0), 3000);
    await performCleanup();
    clearTimeout(timeout);
  });
  process.once("SIGTERM", async () => {
    const timeout = setTimeout(() => process.exit(0), 3000);
    await performCleanup();
    clearTimeout(timeout);
  });

  devServer.app.options("*", (_req: any, res: any) => {
    applyCorsHeaders(res);
    res.status(200).end();
  });

  devServer.app.get("/", (_req: any, res: any) => {
    applyCorsHeaders(res);
    res.json({
      ok: true,
      plugin: pluginInfo.normalizedName,
      version: pluginInfo.version,
      status: devServer.app.locals.handlers?.rpc ? "ready" : "loading",
      endpoints: {
        health: "/",
        docs: "/api",
        rpc: `/api/rpc${rpcPrefix}`,
      },
    });
  });

  devServer.app.get("/health", (_req: any, res: any) => {
    applyCorsHeaders(res);
    res.status(200).send("OK");
  });

  const buildDevContext = (_req: any, webRequest: Request) => {
    const rawClone =
      webRequest.method === "GET" || webRequest.method === "HEAD" ? null : webRequest.clone();
    let cachedRawBody: string | null = null;
    return {
      reqHeaders: webRequest.headers,
      getRawBody: async (): Promise<string> => {
        if (cachedRawBody !== null) return cachedRawBody;
        if (!rawClone) {
          cachedRawBody = "";
          return cachedRawBody;
        }
        cachedRawBody = await rawClone.text();
        return cachedRawBody;
      },
    };
  };

  const handleApiRequest = async (req: any, res: any) => {
    applyCorsHeaders(res);
    const apiHandler = devServer.app.locals.handlers?.api;
    if (!apiHandler) {
      return res.status(503).json({ error: "Plugin still loading..." });
    }

    try {
      const url = `http://${req.headers.host}${req.url}`;
      const webRequest = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
        duplex: req.method !== "GET" && req.method !== "HEAD" ? "half" : undefined,
      } as RequestInit);

      const result = await apiHandler.handle(webRequest, {
        prefix: "/api",
        context: buildDevContext(req, webRequest),
      });

      if (result.response) {
        res.status(result.response.status);
        result.response.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value);
        });
        const text = await result.response.text();
        res.send(text);
      } else {
        res.status(404).send("Not Found");
      }
    } catch (error) {
      console.error("OpenAPI error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  };

  devServer.app.all(`/api/rpc${rpcPrefix}/*`, async (req: any, res: any) => {
    applyCorsHeaders(res);
    const rpcHandler = devServer.app.locals.handlers?.rpc;
    if (!rpcHandler) {
      return res.status(503).json({ error: "Plugin still loading..." });
    }

    try {
      const url = `http://${req.headers.host}${req.url}`;
      const webRequest = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
        duplex: req.method !== "GET" && req.method !== "HEAD" ? "half" : undefined,
      } as RequestInit);

      const result = await rpcHandler.handle(webRequest, {
        prefix: `/api/rpc${rpcPrefix}`,
        context: buildDevContext(req, webRequest),
      });

      if (result.response) {
        res.status(result.response.status);
        result.response.headers.forEach((value: string, key: string) => {
          res.setHeader(key, value);
        });
        const text = await result.response.text();
        res.send(text);
      } else {
        res.status(404).send("Not Found");
      }
    } catch (error) {
      console.error("RPC error:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  devServer.app.all("/api", handleApiRequest);
  devServer.app.all("/api/*", handleApiRequest);
}
