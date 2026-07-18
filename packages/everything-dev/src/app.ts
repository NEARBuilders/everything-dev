import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import type { DevPortState } from "./cli/infra";
import {
  buildRuntimeConfig as configBuildRuntimeConfig,
  getProjectRoot,
  resolveLocalDevelopmentPath,
} from "./config";
import { claimedPorts } from "./process-registry";
import type { AppOrchestrator } from "./service-descriptor";
import type { BosConfig, RuntimeConfig, RuntimePluginConfig } from "./types";

export type { AppOrchestrator };

const DEFAULT_HOST_PORT = 3000;
const DEFAULT_API_PORT = 3001;
const DEFAULT_AUTH_PORT = 3002;
const DEFAULT_UI_PORT = 3003;
const DEFAULT_PLUGIN_PORT_START = 3010;

const PROBE_TIMEOUT_MS = 250;
const MAX_PORT_SCAN_STEPS = 1000;
const PARALLEL_PROBE_WINDOW = 8;

export type PortBudget = { min: number; max: number };

export class PortAllocationError extends Data.TaggedError("PortAllocationError")<{
  preferred: number;
  budget?: PortBudget;
  cause?: unknown;
}> {}

export class PortAllocator extends Context.Tag("PortAllocator")<
  PortAllocator,
  {
    pickAvailable: (
      preferred: number,
      budget?: PortBudget,
    ) => Effect.Effect<number, PortAllocationError>;
  }
>() {}

export function detectLocalPackages(
  bosConfig?: BosConfig,
  runtimeConfig?: RuntimeConfig,
): string[] {
  const packages: string[] = [];
  const configDir = getProjectRoot();

  const uiLocalPath =
    runtimeConfig?.ui.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.ui.development, configDir);
  if (uiLocalPath && existsSync(join(uiLocalPath, "package.json"))) {
    packages.push("ui");
  }

  const apiLocalPath =
    runtimeConfig?.api.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.api.development, configDir);
  if (apiLocalPath && existsSync(join(apiLocalPath, "package.json"))) {
    packages.push("api");
  }

  const hostLocalPath =
    runtimeConfig?.host?.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.host.development, configDir);
  if (hostLocalPath && existsSync(join(hostLocalPath, "package.json"))) {
    packages.push("host");
  } else if (existsSync(join(configDir, "host", "package.json"))) {
    packages.push("host");
  }

  for (const [pluginId, pluginConfig] of Object.entries(runtimeConfig?.plugins ?? {})) {
    if (pluginConfig.localPath && existsSync(join(pluginConfig.localPath, "package.json"))) {
      packages.push(`plugin:${pluginId}`);
    }
    if (pluginConfig.ui?.localPath && existsSync(join(pluginConfig.ui.localPath, "package.json"))) {
      packages.push(`plugin-ui:${pluginId}`);
    }
  }

  const authLocalPath =
    runtimeConfig?.auth?.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.auth?.development, configDir);
  if (authLocalPath && existsSync(join(authLocalPath, "package.json"))) {
    packages.push("auth");
  }

  return packages;
}

export function buildRuntimeConfig(
  bosConfig: BosConfig,
  options: {
    hostSource?: "local" | "remote";
    uiSource?: "local" | "remote";
    apiSource?: "local" | "remote";
    authSource?: "local" | "remote";
    proxy?: string;
    env?: "development" | "production";
    plugins?: Record<string, RuntimePluginConfig>;
  },
): RuntimeConfig {
  return configBuildRuntimeConfig(bosConfig, getProjectRoot(), options.env ?? "development", {
    hostSource: options.hostSource,
    uiSource: options.uiSource,
    apiSource: options.apiSource,
    authSource: options.authSource,
    proxy: options.proxy,
    plugins: options.plugins,
  });
}

function probePortBindable(port: number): Effect.Effect<boolean> {
  return Effect.async<boolean>((resume) => {
    const server = createServer();

    server.once("listening", () => {
      server.close(() => {
        resume(Effect.succeed(true));
      });
    });

    server.once("error", () => {
      server.removeAllListeners();
      // EADDRINUSE, EACCES, or any other bind error → not available
      resume(Effect.succeed(false));
    });

    server.listen(port, "127.0.0.1");

    const timer = setTimeout(() => {
      server.removeAllListeners();
      try {
        server.close();
      } catch {
        // ignore
      }
      resume(Effect.succeed(false));
    }, PROBE_TIMEOUT_MS);

    server.once("listening", () => clearTimeout(timer));
    server.once("error", () => clearTimeout(timer));
  });
}

function pickAvailablePort(
  preferred: number,
  usedPorts: Set<number>,
  budget?: PortBudget,
): Effect.Effect<number, PortAllocationError> {
  return Effect.gen(function* () {
    const within = (candidate: number): boolean =>
      !budget || (candidate >= budget.min && candidate <= budget.max);

    let port = preferred;
    if (!within(port)) {
      port = budget ? budget.min : port;
    }

    const ceiling = budget ? budget.max + 1 : Number.MAX_SAFE_INTEGER;
    let steps = 0;

    const fail = () =>
      Effect.fail(
        new PortAllocationError({
          preferred,
          budget,
          cause: budget
            ? `No free port in budget [${budget.min}, ${budget.max}] starting from ${preferred}`
            : `No free port found starting from ${preferred} within ${MAX_PORT_SCAN_STEPS} steps`,
        }),
      );

    while (true) {
      if (port >= ceiling || steps > MAX_PORT_SCAN_STEPS) {
        yield* fail();
      }

      const candidates: number[] = [];
      for (let i = 0; i < PARALLEL_PROBE_WINDOW && port + i < ceiling; i++) {
        const candidate = port + i;
        if (!usedPorts.has(candidate)) {
          candidates.push(candidate);
        }
      }

      if (candidates.length === 0) {
        port += PARALLEL_PROBE_WINDOW;
        steps += PARALLEL_PROBE_WINDOW;
        continue;
      }

      const results = yield* Effect.forEach(
        candidates,
        (c) => probePortBindable(c).pipe(Effect.map((free) => ({ port: c, free }))),
        { concurrency: "unbounded" },
      );

      const firstFree = results.find((r) => r.free);
      if (firstFree) {
        usedPorts.add(firstFree.port);
        return firstFree.port;
      }

      port += PARALLEL_PROBE_WINDOW;
      steps += PARALLEL_PROBE_WINDOW;
    }
  });
}

export const PortAllocatorLive: Layer.Layer<PortAllocator> = Layer.sync(PortAllocator, () => {
  const usedPorts = claimedPorts();
  return {
    pickAvailable: (preferred, budget) => pickAvailablePort(preferred, usedPorts, budget),
  };
});

function withLocalRuntimeUrl<
  T extends { url: string; entry: string; port?: number; localPath?: string },
>(entry: T, port: number): T {
  const url = `http://localhost:${port}`;
  return {
    ...entry,
    url,
    entry: `${url}/mf-manifest.json`,
    port,
  };
}

export interface DevPortOptions {
  hostPort?: number;
  apiPort?: number;
  uiPort?: number;
  authPort?: number;
  pluginPortStart?: number;
  ssr?: boolean;
  portBudget?: PortBudget;
}

export interface PreparedDevRuntime {
  runtimeConfig: RuntimeConfig;
  devPorts: DevPortState;
}

export function prepareDevelopmentRuntimeConfig(
  runtimeConfig: RuntimeConfig,
  options?: DevPortOptions,
): Effect.Effect<PreparedDevRuntime, PortAllocationError, PortAllocator> {
  return Effect.gen(function* () {
    const allocator = yield* PortAllocator;
    const budget = options?.portBudget;

    const pickedHostPort = yield* allocator.pickAvailable(
      options?.hostPort ?? DEFAULT_HOST_PORT,
      budget,
    );

    const hostIsLocal = runtimeConfig.host.source === "local";
    const next: RuntimeConfig = {
      ...runtimeConfig,
      host: hostIsLocal
        ? {
            ...runtimeConfig.host,
            url: `http://localhost:${pickedHostPort}`,
            port: pickedHostPort,
          }
        : { ...runtimeConfig.host },
      ui: { ...runtimeConfig.ui },
      api: { ...runtimeConfig.api },
      auth: runtimeConfig.auth ? { ...runtimeConfig.auth } : undefined,
      plugins: runtimeConfig.plugins ? { ...runtimeConfig.plugins } : undefined,
    };

    const devPorts: DevPortState = {
      host: hostIsLocal ? pickedHostPort : undefined,
      api: undefined,
      ui: undefined,
      auth: undefined,
      pluginPortStart: undefined,
    };

    if (next.api.source === "local" && next.api.localPath) {
      const apiPort = yield* allocator.pickAvailable(
        options?.apiPort ?? next.api.port ?? DEFAULT_API_PORT,
        budget,
      );
      next.api = withLocalRuntimeUrl(next.api, apiPort);
      devPorts.api = apiPort;
    }

    if (next.auth?.source === "local" && next.auth.localPath) {
      const authPort = yield* allocator.pickAvailable(
        options?.authPort ?? next.auth.port ?? DEFAULT_AUTH_PORT,
        budget,
      );
      next.auth = withLocalRuntimeUrl(next.auth, authPort);
      devPorts.auth = authPort;
    }

    if (next.ui.source === "local" && next.ui.localPath) {
      const uiPort = yield* allocator.pickAvailable(
        options?.uiPort ?? next.ui.port ?? DEFAULT_UI_PORT,
        budget,
      );
      next.ui = withLocalRuntimeUrl(next.ui, uiPort);
      devPorts.ui = uiPort;
      if (options?.ssr) {
        const ssrPort = yield* allocator.pickAvailable(uiPort + 1, budget);
        next.ui.ssrUrl = `http://localhost:${ssrPort}`;
      } else {
        next.ui.ssrUrl = undefined;
      }
    }

    if (next.plugins) {
      const entries = Object.entries(next.plugins).sort(([a], [b]) => a.localeCompare(b));
      let pluginBasePort = options?.pluginPortStart ?? DEFAULT_PLUGIN_PORT_START;
      let firstLocalPluginPort: number | undefined;

      for (const [pluginId, plugin] of entries) {
        if (plugin.source === "local" && plugin.localPath) {
          const pluginPort = yield* allocator.pickAvailable(plugin.port ?? pluginBasePort, budget);
          next.plugins[pluginId] = withLocalRuntimeUrl(plugin, pluginPort);
          if (firstLocalPluginPort === undefined) firstLocalPluginPort = pluginPort;
          pluginBasePort = pluginPort + 1;
        }

        if (plugin.ui?.source === "local" && plugin.ui.localPath) {
          const pluginUiPort = yield* allocator.pickAvailable(
            plugin.ui.port ?? pluginBasePort,
            budget,
          );
          next.plugins[pluginId] = {
            ...next.plugins[pluginId]!,
            ui: withLocalRuntimeUrl(plugin.ui, pluginUiPort),
          };
          if (firstLocalPluginPort === undefined) firstLocalPluginPort = pluginUiPort;
          pluginBasePort = pluginUiPort + 1;
        }
      }

      devPorts.pluginPortStart = firstLocalPluginPort;
    }

    return { runtimeConfig: next, devPorts };
  });
}
