import { Effect } from "effect";
import {
  type DevViewHandle,
  type LogEntry,
  type ProcessState,
  renderDevView,
} from "./components/dev-view";
import { renderStreamingView } from "./components/streaming-view";
import { getProjectRoot } from "./config";
import { createDevLogger } from "./dev-logs";
import {
  getProcessConfig,
  makeDevProcess,
  type ProcessCallbacks,
  type ProcessHandle,
} from "./orchestrator";
import { makeProcessRegistry } from "./process-registry";
import type { BosConfig, RuntimeConfig, SourceMode } from "./types";

export interface AppConfig {
  host: SourceMode;
  ui: SourceMode;
  api: SourceMode;
  proxy?: boolean;
  ssr?: boolean;
}

export interface AppOrchestrator {
  packages: string[];
  env: Record<string, string>;
  description: string;
  appConfig: AppConfig;
  bosConfig: BosConfig;
  runtimeConfig: RuntimeConfig;
  port?: number;
  interactive?: boolean;
  noLogs?: boolean;
}

const LOG_NOISE_PATTERNS = [
  /\[ Federation Runtime \] Version .* from (host|ui) of shared singleton module/,
  /Executing an Effect versioned \d+\.\d+\.\d+ with a Runtime of version/,
  /you may want to dedupe the effect dependencies/,
];

const SSR_LOG_ALLOWLIST = [
  /\bready\s+built in\b/i,
  /\bcompiled\b.*successfully/i,
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
];

const shouldDisplayLog = (source: string, line: string, isError?: boolean): boolean => {
  if (process.env.DEBUG === "true" || process.env.DEBUG === "1") return true;
  if (source === "ui-ssr") {
    if (isError) return true;
    return SSR_LOG_ALLOWLIST.some((pattern) => pattern.test(line));
  }
  return !LOG_NOISE_PATTERNS.some((pattern) => pattern.test(line));
};

const isInteractiveSupported = (): boolean => {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
};

const STARTUP_ORDER = ["ui-ssr", "ui", "api", "plugin", "host-build", "host"];

const sortByOrder = (packages: string[]): string[] => {
  return [...packages].sort((a, b) => {
    const aIdx = a.startsWith("plugin:")
      ? STARTUP_ORDER.indexOf("plugin")
      : STARTUP_ORDER.indexOf(a);
    const bIdx = b.startsWith("plugin:")
      ? STARTUP_ORDER.indexOf("plugin")
      : STARTUP_ORDER.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
};

function formatLogLine(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  const prefix = entry.isError ? "ERR" : "OUT";
  return `[${ts}] [${entry.source}] [${prefix}] ${entry.line}`;
}

export const runDevSession = (
  orchestrator: AppOrchestrator,
  onCleanupReady?: (cleanup: () => Promise<void>) => void,
) =>
  Effect.gen(function* () {
    const configDir = getProjectRoot();
    const orderedPackages = sortByOrder(orchestrator.packages);
    const initialProcesses: ProcessState[] = orderedPackages.map((pkg) => {
      const portOverride = pkg === "host" ? orchestrator.port : undefined;
      const config = getProcessConfig(
        pkg,
        undefined,
        portOverride,
        orchestrator.bosConfig,
        orchestrator.runtimeConfig,
      );
      const source =
        pkg === "host"
          ? orchestrator.appConfig.host
          : pkg === "ui"
            ? orchestrator.appConfig.ui
            : pkg === "api"
              ? orchestrator.appConfig.api
              : undefined;
      return {
        name: pkg,
        status: "pending" as const,
        port: config?.port ?? 0,
        source,
      };
    });

    const registry = yield* makeProcessRegistry(configDir);
    yield* registry.killAll().pipe(Effect.ignore);

    const logger = yield* Effect.promise(() =>
      createDevLogger(configDir, orchestrator.description),
    );
    const handles: ProcessHandle[] = [];
    const allLogs: LogEntry[] = [];
    let view: DevViewHandle | null = null;
    let shuttingDown = false;

    const killAll = async () => {
      const reversed = [...handles].reverse();
      for (const handle of reversed) {
        try {
          await handle.kill();
        } catch {}
      }
      await Effect.runPromise(registry.killAll(true)).catch(() => {});
    };

    const exportLogs = async () => {
      console.log("\n");
      console.log("═".repeat(70));
      console.log(`  SESSION LOGS: ${orchestrator.description}`);
      console.log(`  Started: ${new Date(allLogs[0]?.timestamp || Date.now()).toISOString()}`);
      console.log(`  Total entries: ${allLogs.length}`);
      console.log("═".repeat(70));
      console.log("");
      for (const entry of allLogs) {
        console.log(formatLogLine(entry));
      }
      console.log("");
      console.log("═".repeat(70));
      console.log(`  Full logs saved to: ${logger.logFile}`);
      console.log("═".repeat(70));
      console.log("");
    };

    const cleanup = async (showLogs = false) => {
      if (shuttingDown) return;
      shuttingDown = true;
      view?.unmount();
      await killAll();
      if (showLogs) {
        await exportLogs();
      }
    };

    onCleanupReady?.(cleanup);

    const useInteractive = orchestrator.interactive ?? isInteractiveSupported();
    view = useInteractive
      ? renderDevView(
          initialProcesses,
          orchestrator.description,
          orchestrator.env,
          () => cleanup(false),
          () => cleanup(true),
        )
      : renderStreamingView(initialProcesses, orchestrator.description, orchestrator.env, () =>
          cleanup(false),
        );

    const callbacks: ProcessCallbacks = {
      onStatus: (name, status, message) => {
        view?.updateProcess(name, status, message);
      },
      onLog: (name, line, isError) => {
        const entry: LogEntry = {
          id: `${Date.now()}-${allLogs.length + 1}`,
          source: name,
          line,
          timestamp: Date.now(),
          isError,
        };
        allLogs.push(entry);
        if (shouldDisplayLog(name, line, isError)) {
          view?.addLog(name, line, isError);
        }
        if (!orchestrator.noLogs) {
          void logger.write(entry);
        }
      },
    };

    const startProcess = (pkg: string) => {
      const portOverride = pkg === "host" ? orchestrator.port : undefined;
      return makeDevProcess(
        pkg,
        orchestrator.env,
        callbacks,
        portOverride,
        orchestrator.bosConfig,
        orchestrator.runtimeConfig,
        registry,
      );
    };

    const startGroup = (packages: string[]) =>
      Effect.forEach(packages, startProcess, { concurrency: "unbounded" });

    const awaitReady = (pkg: string, handle: ProcessHandle) =>
      Effect.race(
        handle.waitForReady,
        Effect.sleep("30 seconds").pipe(
          Effect.andThen(
            Effect.sync(() => {
              callbacks.onLog(pkg, "Timeout waiting for ready, continuing...", true);
            }),
          ),
        ),
      );

    const nonHostPackages = orderedPackages.filter((pkg) => pkg !== "host");
    const hostPackages = orderedPackages.filter((pkg) => pkg === "host");

    const nonHostHandles = yield* startGroup(nonHostPackages);
    handles.push(...nonHostHandles);

    yield* Effect.forEach(
      nonHostHandles.map((handle, index) => ({
        handle,
        pkg: nonHostPackages[index] ?? handle.name,
      })),
      ({ handle, pkg }) => awaitReady(pkg, handle),
      { concurrency: "unbounded" },
    );

    const hostHandles = yield* startGroup(hostPackages);
    handles.push(...hostHandles);

    yield* Effect.forEach(
      hostHandles.map((handle, index) => ({ handle, pkg: hostPackages[index] ?? handle.name })),
      ({ handle, pkg }) => awaitReady(pkg, handle),
      { concurrency: "unbounded" },
    );

    yield* Effect.addFinalizer(() => Effect.promise(() => cleanup(false)));
    yield* Effect.never;
  });

export const startApp = (orchestrator: AppOrchestrator) => {
  let activeCleanup: (() => Promise<void>) | null = null;

  const program = Effect.scoped(
    runDevSession(orchestrator, (cleanup) => {
      activeCleanup = cleanup;
    }),
  ).pipe(
    Effect.catchAll((e) =>
      Effect.sync(() => {
        if (e instanceof Error) {
          console.error("App server error:", e.message);
          if (e.stack) console.error(e.stack);
        } else {
          console.error("App server error:", e);
        }
      }),
    ),
  );

  const handleSignal = async () => {
    if (activeCleanup) await activeCleanup();
  };

  const forceExit = () => {
    console.log("\n[Dev] Force exit");
    process.exit(0);
  };

  let signalCount = 0;
  process.on("SIGINT", () => {
    signalCount++;
    if (signalCount > 1) {
      forceExit();
      return;
    }
    const timeout = setTimeout(forceExit, 5000);
    void handleSignal().finally(() => {
      clearTimeout(timeout);
    });
  });
  process.on("SIGTERM", () => {
    signalCount++;
    if (signalCount > 1) {
      forceExit();
      return;
    }
    const timeout = setTimeout(forceExit, 5000);
    void handleSignal().finally(() => {
      clearTimeout(timeout);
    });
  });

  void Effect.runPromise(program);
};
