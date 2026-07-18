import * as NodeContext from "@effect/platform-node/NodeContext";
import { Deferred, Effect, Exit } from "effect";
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
  getProcessStates,
  makeDevProcess,
  type ProcessCallbacks,
  type ProcessHandle,
} from "./orchestrator";
import { registerStandalone, unregisterPid } from "./process-registry";
import {
  type AppOrchestrator,
  DevRuntimeConfig,
  DevRuntimeConfigLive,
  type ServiceDescriptor,
  ServiceDescriptorMap,
  ServiceDescriptorMapLive,
} from "./service-descriptor";
import type { RuntimeConfig } from "./types";

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

const STARTUP_ORDER = ["ui-ssr", "ui", "auth", "api", "plugin", "host-build", "host"];

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
  onShutdownReady?: (requestShutdown: () => void) => void,
) =>
  Effect.gen(function* () {
    const configDir = getProjectRoot();
    const services = yield* ServiceDescriptorMap;
    const runtimeConfig = yield* DevRuntimeConfig;
    const orderedPackages = sortByOrder(orchestrator.packages);
    const initialProcesses: ProcessState[] = getProcessStates(
      orderedPackages,
      services,
      orchestrator.port,
    );

    if (process.env.DEBUG === "true" || process.env.DEBUG === "1") {
      console.error("[DEBUG session] orchestrator.packages:", orchestrator.packages.join(", "));
      console.error("[DEBUG session] orderedPackages:", orderedPackages.join(", "));
      console.error("[DEBUG session] services keys:", [...services.keys()].join(", "));
      console.error(
        "[DEBUG session] initialProcesses:",
        initialProcesses.map((p) => `${p.name}=${p.source}`).join(", "),
      );
    }

    const logger = yield* Effect.promise(() =>
      createDevLogger(configDir, orchestrator.description),
    );

    const shutdown = yield* Deferred.make<void>();

    onShutdownReady?.(() => {
      void Effect.runPromise(Deferred.succeed(shutdown, undefined));
    });

    const isWorkspaceChild = process.env.BOS_WORKSPACE_CHILD === "1";
    if (!isWorkspaceChild) {
      registerStandalone({
        pid: process.pid,
        configDir,
        ports: {
          host: runtimeConfig.host.port,
          api: runtimeConfig.api.port,
          ui: runtimeConfig.ui.port,
          auth: runtimeConfig.auth?.port,
        },
        startedAt: Date.now(),
        description: orchestrator.description,
      });
    }

    const allLogs: LogEntry[] = [];
    let view: DevViewHandle | null = null;
    let shouldExportLogs = false;

    const requestShutdownAndExport = () => {
      shouldExportLogs = true;
      void Effect.runPromise(Deferred.succeed(shutdown, undefined));
    };

    const useInteractive = orchestrator.interactive ?? isInteractiveSupported();
    view = useInteractive
      ? renderDevView(
          initialProcesses,
          orchestrator.description,
          orchestrator.env,
          () => void Effect.runPromise(Deferred.succeed(shutdown, undefined)),
          requestShutdownAndExport,
        )
      : renderStreamingView(
          initialProcesses,
          orchestrator.description,
          orchestrator.env,
          () => void Effect.runPromise(Deferred.succeed(shutdown, undefined)),
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
      return makeDevProcess(pkg, callbacks, portOverride).pipe(
        Effect.tapError((err) =>
          Effect.sync(() => {
            callbacks.onLog(pkg, `Failed to start: ${err}`, true);
            callbacks.onStatus(pkg, "error");
          }),
        ),
        Effect.catchAll(() =>
          Effect.succeed({
            name: pkg,
            pid: undefined,
            kill: Effect.void,
            waitForReady: Effect.void,
            waitForExit: Effect.never,
          } satisfies ProcessHandle),
        ),
      );
    };

    const startGroup = (packages: string[]) =>
      Effect.forEach(packages, startProcess, { concurrency: "unbounded" });

    const awaitReady = (pkg: string, handle: ProcessHandle) =>
      handle.waitForReady.pipe(
        Effect.timeout("120 seconds"),
        Effect.catchAll((err) =>
          Effect.sync(() => {
            callbacks.onLog(
              pkg,
              `Timed out or failed: ${err instanceof Error ? err.message : String(err)}`,
              true,
            );
          }),
        ),
      );

    const nonHostPackages = orderedPackages.filter((pkg) => pkg !== "host");
    const hostPackages = orderedPackages.filter((pkg) => pkg === "host");

    const nonHostHandles = yield* startGroup(nonHostPackages);

    yield* Effect.forEach(
      nonHostHandles.map((handle, index) => ({
        handle,
        pkg: nonHostPackages[index] ?? handle.name,
      })),
      ({ handle, pkg }) => awaitReady(pkg, handle),
      { concurrency: "unbounded" },
    );

    const hostHandles = yield* startGroup(hostPackages);

    yield* Effect.forEach(
      hostHandles.map((handle, index) => ({ handle, pkg: hostPackages[index] ?? handle.name })),
      ({ handle, pkg }) => awaitReady(pkg, handle),
      { concurrency: "unbounded" },
    );

    const allHandles = [...nonHostHandles, ...hostHandles];

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.forEach(allHandles, (h) => h.kill.pipe(Effect.ignore), {
          concurrency: "unbounded",
        });

        yield* Effect.sleep("200 millis");

        view?.unmount();

        if (!isWorkspaceChild) {
          try {
            unregisterPid(process.pid);
          } catch {
            // best-effort; pruneDead cleans stale entries on next ps/kill
          }
        }

        if (shouldExportLogs) {
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
        }
      }),
    );

    yield* Deferred.await(shutdown);
  });

const runApp = (
  orchestrator: AppOrchestrator,
  services: Map<string, ServiceDescriptor>,
  runtimeConfig: RuntimeConfig,
) => {
  let requestShutdown: (() => void) | null = null;
  let signalCount = 0;
  let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

  const forceExit = () => {
    console.log("\n[Dev] Force exit");
    process.exit(0);
  };

  const program = Effect.scoped(
    runDevSession(orchestrator, (shutdown) => {
      requestShutdown = shutdown;
    }),
  ).pipe(
    Effect.provide(ServiceDescriptorMapLive(services)),
    Effect.provide(DevRuntimeConfigLive(runtimeConfig)),
    Effect.provide(NodeContext.layer),
    Effect.catchAllDefect((defect) =>
      Effect.sync(() => {
        console.error("[Dev] Unhandled defect in orchestrator:", defect);
      }),
    ),
  );

  const handleSignal = () => {
    signalCount++;
    if (signalCount > 1) {
      forceExit();
      return;
    }
    console.log("\n[Dev] Shutting down...");
    forceExitTimer = setTimeout(forceExit, 5000);
    requestShutdown?.();
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  Effect.runPromiseExit(program).then((exit) => {
    if (forceExitTimer) clearTimeout(forceExitTimer);
    process.exit(Exit.isSuccess(exit) ? 0 : 0);
  });
};

export const devApp = runApp;

export const startApp = runApp;
