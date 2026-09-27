import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import {
  buildRuntimeConfig as configBuildRuntimeConfig,
  getProjectRoot,
  resolveLocalDevelopmentPath,
} from "./config";
import { claimedPorts } from "./process-registry";
import type { AppOrchestrator } from "./service-descriptor";
import type { BosConfig, RuntimeConfig, RuntimePluginConfig } from "./types";

export type { AppOrchestrator };

const PROBE_TIMEOUT_MS = 250;
const MAX_PORT_SCAN_STEPS = 1000;
const PARALLEL_PROBE_WINDOW = 8;
const BLOCK_STEP = 100;

export type PortBudget = { min: number; max: number };

export class PortAllocationError extends Data.TaggedError("PortAllocationError")<{
  preferred: number;
  budget?: PortBudget;
  cause?: unknown;
}> {}

export interface PortBlockEntry {
  key: string;
  preferred: number;
  pinned: boolean;
}

export interface PortBlockRequest {
  base: number;
  step?: number;
  entries: PortBlockEntry[];
}

export interface PortBlockAllocation {
  base: number;
  ports: Record<string, number>;
  conflicts: Array<{ key: string; port: number; claimed: boolean }>;
}

export class PortAllocator extends Context.Service<
  PortAllocator,
  {
    pickAvailable: (
      preferred: number,
      budget?: PortBudget,
    ) => Effect.Effect<number, PortAllocationError>;
    acquireBlock: (
      request: PortBlockRequest,
    ) => Effect.Effect<PortBlockAllocation, PortAllocationError>;
  }
>()("PortAllocator") {}

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

export async function buildRuntimeConfig(
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
): Promise<RuntimeConfig> {
  return configBuildRuntimeConfig(bosConfig, getProjectRoot(), options.env ?? "development", {
    hostSource: options.hostSource,
    uiSource: options.uiSource,
    apiSource: options.apiSource,
    authSource: options.authSource,
    proxy: options.proxy,
    plugins: options.plugins,
  });
}

export function probePortBindable(port: number): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
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
        return yield* fail();
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
    acquireBlock: (request) => acquireBlockPort(request, usedPorts),
  };
});

// acquireBlockPort validates and acquires a whole port block atomically: every
// entry is probed before any is yielded; on any conflict the entire block
// steps (base += step) and retries. Pinned entries (explicit CLI flags) are
// absolute — an actual listener on one fails loudly instead of silently
// drifting a port the user named; a registry claim without a listener is
// stale (PID reuse across container restarts) and never wedges allocation.
function acquireBlockPort(
  request: PortBlockRequest,
  usedPorts: Set<number>,
): Effect.Effect<PortBlockAllocation, PortAllocationError> {
  const step = request.step ?? BLOCK_STEP;
  const fail = (cause: string) =>
    Effect.fail(
      new PortAllocationError({
        preferred: request.base,
        cause,
      }),
    );

  return Effect.gen(function* () {
    let base = request.base;
    let steps = 0;
    let firstConflicts: PortBlockAllocation["conflicts"] = [];
    while (steps <= MAX_PORT_SCAN_STEPS) {
      const shift = base - request.base;
      const candidates = request.entries.map((entry) => ({
        ...entry,
        port: entry.pinned ? entry.preferred : entry.preferred + shift,
      }));

      // Pinned entries are absolute (ADR 0012): an actual listener on one
      // fails loudly instead of drifting a port the user named. Verified
      // against the real socket every iteration — a registry claim without
      // a listener is stale (PID reuse across container restarts) and must
      // never wedge a pinned allocation.
      let pinnedHeldByListener: (typeof candidates)[number] | undefined;
      for (const candidate of candidates.filter((c) => c.pinned)) {
        const bindable = yield* probePortBindable(candidate.port);
        if (!bindable) {
          pinnedHeldByListener = candidate;
          break;
        }
        usedPorts.delete(candidate.port);
      }
      if (pinnedHeldByListener) {
        return yield* fail(
          `explicitly-requested port ${pinnedHeldByListener.port} (${pinnedHeldByListener.key}) is occupied by a listener`,
        );
      }

      const unpinned = candidates.filter((c) => !c.pinned);
      const claimConflicts = unpinned
        .filter((c) => usedPorts.has(c.port))
        .map((c) => ({ key: c.key, port: c.port, claimed: true }));
      if (shift === 0) {
        firstConflicts = claimConflicts;
      }

      if (claimConflicts.length === 0) {
        const results = yield* Effect.forEach(
          unpinned,
          (c) => probePortBindable(c.port).pipe(Effect.map((free) => ({ ...c, free }))),
          { concurrency: "unbounded" },
        );
        const busy = results.filter((r) => !r.free);
        if (shift === 0) {
          firstConflicts = busy.map((b) => ({ key: b.key, port: b.port, claimed: false }));
        }
        if (busy.length === 0) {
          for (const candidate of candidates) usedPorts.add(candidate.port);
          return {
            base,
            ports: Object.fromEntries(candidates.map((c) => [c.key, c.port])),
            conflicts: firstConflicts,
          };
        }
      }

      base += step;
      steps += 1;
    }
    return yield* fail(
      `no free port block within ${MAX_PORT_SCAN_STEPS} steps of base ${request.base} (step ${step})`,
    );
  });
}
