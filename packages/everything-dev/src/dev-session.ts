import { Clock, DateTime, Deferred, Effect, Exit, Layer } from "effect";
import { probePortBindable } from "./app";
import {
  createDevRenderer,
  type DevProcessState,
  type DevRendererHandle,
} from "./components/dev-render";
import { createLogPipeline, type LogEvent, resolveLogLevel } from "./dev-log-pipeline";
import { createDevLogger, formatLogLine } from "./dev-logs";
import { getProcessEnv } from "./env/process-env";
import { ShellEnvLive } from "./env/project-env";
import { ownerOfPort } from "./infra/port-ownership";
import {
  getProcessStates,
  makeDevProcess,
  type ProcessCallbacks,
  type ProcessHandle,
} from "./orchestrator";
import { reapGroup } from "./process-kill";
import {
  isPidAlive,
  readRegistry,
  registerStandalone,
  unregisterPid,
  updateChildPids,
  writeRegistry,
} from "./process-registry";
import {
  type AppOrchestrator,
  DevGeneratedEnvLive,
  DevRuntimeConfig,
  DevRuntimeConfigLive,
  isAuthMirrorPluginEntry,
  type ServiceDescriptor,
  ServiceDescriptorMap,
  ServiceDescriptorMapLive,
} from "./service-descriptor";
import type { RuntimeConfig } from "./types";

const adoptOrphanedChildren = (configDir: string): void => {
  try {
    const entries = readRegistry().filter(
      (entry) => entry.pid > 1 && entry.configDir === configDir && !isPidAlive(entry.pid),
    );
    if (entries.length === 0) return;
    const reaped: number[] = [];
    for (const entry of entries) {
      for (const childPid of entry.childPids ?? []) {
        if (childPid === process.pid) continue;
        if (isPidAlive(childPid)) {
          reapGroup(childPid);
          reaped.push(childPid);
        }
      }
    }
    if (reaped.length > 0) {
      console.error(
        `[Dev] Reaped ${reaped.length} orphaned child process(es) from dead session(s): ${reaped.join(", ")}`,
      );
    }
    const deadPids = new Set(entries.map((entry) => entry.pid));
    writeRegistry(readRegistry().filter((entry) => !deadPids.has(entry.pid)));
  } catch {
    // best-effort; registry hygiene is non-critical for the running session
  }
};

const isInteractiveSupported = (): boolean => {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
};

const STARTUP_ORDER = ["ui", "auth", "api", "plugin", "host-build", "host"];

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

export interface DevSessionControls {
  requestShutdown: () => void;
  emergencyKill: () => void;
  requestShutdownEscalating: () => void;
  forceExit: () => void;
  restoreView: () => void;
  rearmForceExitTimer: () => void;
}

export const runDevSession = (
  configDir: string,
  orchestrator: AppOrchestrator,
  onShutdownReady?: (controls: DevSessionControls) => void,
) =>
  Effect.gen(function* () {
    adoptOrphanedChildren(configDir);
    const services = yield* ServiceDescriptorMap;
    const runtimeConfig = yield* DevRuntimeConfig;
    const orderedPackages = sortByOrder(orchestrator.packages);
    const initialProcesses: DevProcessState[] = getProcessStates(
      orderedPackages,
      services,
      orchestrator.port,
    );

    if (getProcessEnv("DEBUG") === "true" || getProcessEnv("DEBUG") === "1") {
      yield* Effect.logError(
        `[DEBUG session] orchestrator.packages: ${orchestrator.packages.join(", ")}`,
      );
      yield* Effect.logError(`[DEBUG session] orderedPackages: ${orderedPackages.join(", ")}`);
      yield* Effect.logError(`[DEBUG session] services keys: ${[...services.keys()].join(", ")}`);
      yield* Effect.logError(
        `[DEBUG session] initialProcesses: ${initialProcesses.map((p) => `${p.name}=${p.source}`).join(", ")}`,
      );
    }

    const logger = yield* Effect.promise(() =>
      createDevLogger(configDir, orchestrator.description),
    );

    const shutdown = yield* Deferred.make<void>();

    const effectContext = yield* Effect.context();
    const controls: DevSessionControls = {
      requestShutdown: () => {
        void Effect.runPromiseWith(effectContext)(Deferred.succeed(shutdown, undefined));
      },
      emergencyKill: () => {},
      requestShutdownEscalating: () => {},
      forceExit: () => {},
      restoreView: () => {},
      rearmForceExitTimer: () => {},
    };

    onShutdownReady?.(controls);

    const isWorkspaceChild = getProcessEnv("BOS_WORKSPACE_CHILD") === "1";
    let ownedPorts: number[] = [];
    if (!isWorkspaceChild) {
      const regPorts: Record<string, number> = {};
      const addPort = (key: string, value: number | undefined | null) => {
        if (value != null) regPorts[key] = value;
      };
      addPort("host", runtimeConfig.host.port);
      addPort("api", runtimeConfig.api.port);
      addPort("ui", runtimeConfig.ui.port);
      addPort("auth", runtimeConfig.auth?.port);
      if (runtimeConfig.plugins) {
        for (const [id, plugin] of Object.entries(runtimeConfig.plugins)) {
          if (!isAuthMirrorPluginEntry(runtimeConfig.auth, id, plugin)) {
            addPort(`plugin:${id}`, plugin.port);
          }
          addPort(`plugin-ui:${id}`, plugin.ui?.port);
        }
      }
      registerStandalone({
        pid: process.pid,
        configDir,
        ports: regPorts,
        startedAt: yield* Clock.currentTimeMillis,
        description: orchestrator.description,
      });
      ownedPorts = Object.values(regPorts);
    }

    let view: DevRendererHandle | null = null;
    let shouldExportLogs = false;

    const logLevel = resolveLogLevel();
    const allLogs: LogEvent[] = [];
    const pipeline = createLogPipeline({
      level: logLevel,
      sinks: {
        display: (event) => {
          view?.addLog(event.source, event.line, event.level === "error");
        },
        file: (event) => {
          if (orchestrator.noLogs) return;
          void logger.write(event);
        },
        export: (event) => {
          allLogs.push(event);
        },
      },
    });

    const useInteractive = isInteractiveSupported() && orchestrator.interactive !== false;
    view = createDevRenderer(
      initialProcesses,
      orchestrator.description,
      orchestrator.env,
      () => controls.requestShutdownEscalating(),
      () => {
        shouldExportLogs = true;
        controls.requestShutdownEscalating();
      },
      { interactive: useInteractive, onForceExit: () => controls.forceExit() },
    );
    controls.restoreView = () => {
      if (useInteractive) view?.unmount();
    };

    const callbacks: ProcessCallbacks = {
      onStatus: (name, status, message) => {
        view?.updateProcess(name, status, message);
      },
      onLog: (name, line, isError) => {
        pipeline.ingest({ source: name, line, isError });
      },
    };

    const spawned: ProcessHandle[] = [];

    controls.emergencyKill = () => {
      for (const handle of spawned) {
        if (handle.pid === undefined) continue;
        reapGroup(handle.pid);
      }
    };

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        controls.rearmForceExitTimer();

        yield* Effect.forEach(spawned, (h) => h.kill.pipe(Effect.ignore), {
          concurrency: "unbounded",
        });

        yield* Effect.sleep("200 millis");

        for (const port of ownedPorts) {
          const bindable = yield* probePortBindable(port);
          if (!bindable) {
            const owner = yield* ownerOfPort(port);
            yield* Effect.logError(
              `[Dev] Port ${port} still bound after teardown${
                owner
                  ? ` — pid ${owner.pid} (${owner.command})`
                  : " — owner unknown (lsof unavailable)"
              }`,
            );
          }
        }

        if (!isWorkspaceChild) {
          yield* Effect.sync(() => {
            try {
              unregisterPid(process.pid);
            } catch {
              // best-effort; pruneDead cleans stale entries on next ps/kill
            }
          });
        }

        pipeline.flush();

        view?.unmount();

        if (shouldExportLogs) {
          const now = yield* Clock.currentTimeMillis;
          const startedMs = allLogs[0]?.timestamp || now;
          yield* Effect.log("");
          yield* Effect.log("═".repeat(70));
          yield* Effect.log(`  SESSION LOGS: ${orchestrator.description}`);
          yield* Effect.log(`  Started: ${DateTime.formatIso(DateTime.makeUnsafe(startedMs))}`);
          yield* Effect.log(`  Filtered entries: ${allLogs.length} (level: ${logLevel})`);
          yield* Effect.log("═".repeat(70));
          yield* Effect.log("");
          for (const event of allLogs) {
            yield* Effect.log(formatLogLine(event));
          }
          yield* Effect.log("");
          yield* Effect.log("═".repeat(70));
          yield* Effect.log(`  Full logs saved to: ${logger.logFile}`);
          yield* Effect.log("═".repeat(70));
          yield* Effect.log("");
        }
      }),
    );

    const startProcess = (pkg: string) => {
      const portOverride = pkg === "host" ? orchestrator.port : undefined;
      return makeDevProcess(pkg, callbacks, portOverride).pipe(
        Effect.tap((handle) => Effect.sync(() => spawned.push(handle))),
        Effect.flatMap((handle) =>
          Effect.acquireRelease(Effect.succeed(handle), () => handle.kill.pipe(Effect.ignore)),
        ),
        Effect.tapError((err) =>
          Effect.sync(() => {
            callbacks.onLog(pkg, `Failed to start: ${String(err)}`, true);
            callbacks.onStatus(pkg, "error");
          }),
        ),
        Effect.orElseSucceed(
          () =>
            ({
              name: pkg,
              pid: undefined,
              kill: Effect.void,
              waitForReady: Effect.void,
              waitForExit: Effect.never,
            }) satisfies ProcessHandle,
        ),
      );
    };

    const startGroup = (packages: string[]) =>
      Effect.forEach(packages, startProcess, { concurrency: "unbounded" });

    const awaitReady = (pkg: string, handle: ProcessHandle) =>
      handle.waitForReady.pipe(
        Effect.timeout("120 seconds"),
        Effect.catch((err) =>
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

    const startupPhase = Effect.gen(function* () {
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
        hostHandles.map((handle, index) => ({
          handle,
          pkg: hostPackages[index] ?? handle.name,
        })),
        ({ handle, pkg }) => awaitReady(pkg, handle),
        { concurrency: "unbounded" },
      );

      return { nonHostHandles, hostHandles };
    });

    const startup = yield* Effect.raceFirst(
      startupPhase,
      Deferred.await(shutdown).pipe(Effect.as(null)),
    );

    if (startup === null) return;

    const allHandles = [...startup.nonHostHandles, ...startup.hostHandles];

    const childPids = allHandles
      .map((handle) => Number(handle.pid))
      .filter((pid) => Number.isFinite(pid) && pid > 1 && pid !== process.pid);

    if (!isWorkspaceChild && childPids.length > 0) {
      yield* Effect.sync(() => {
        try {
          updateChildPids(process.pid, childPids);
        } catch {
          // best-effort; registry hygiene is non-critical for the running session
        }
      });
    }

    yield* Deferred.await(shutdown);
  });

const runApp = (
  configDir: string,
  orchestrator: AppOrchestrator,
  services: Map<string, ServiceDescriptor>,
  runtimeConfig: RuntimeConfig,
  envGenerated: Record<string, string>,
  shellEnv: Record<string, string>,
) => {
  let controls: DevSessionControls | null = null;
  let signalCount = 0;
  let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

  const forceExit = () => {
    controls?.restoreView();
    console.log("\n[Dev] Force exit");
    controls?.emergencyKill();
    process.exit(0);
  };

  // Orphan watch: when the wrapper chain above this process dies (playwright
  // tree-kills its webServer with SIGKILL — no signal handler runs, detached
  // group escapes), this orchestrator is reparented. Detect that and reap the
  // whole service tree — the alternatives are zombie port squatters that
  // poison the next run. Covers shell aborts (Ctrl+C killing only the
  // wrapper) the same way.
  const initialPpid = process.ppid;
  const orphanWatch = setInterval(() => {
    if (process.ppid !== initialPpid) {
      console.error("\n[Dev] Parent process died — force exiting (orphaned service tree)");
      forceExit();
    }
  }, 200);
  orphanWatch.unref?.();

  const requestShutdownEscalating = () => {
    signalCount++;
    if (signalCount > 1) {
      forceExit();
      return;
    }
    controls?.restoreView();
    console.log("\n[Dev] Shutting down...");
    forceExitTimer = setTimeout(forceExit, 5000);
    forceExitTimer.unref?.();
    controls?.requestShutdown();
  };
  const handleSignal = requestShutdownEscalating;

  const program = Effect.scoped(
    runDevSession(configDir, orchestrator, (sessionControls) => {
      controls = sessionControls;
      sessionControls.requestShutdownEscalating = requestShutdownEscalating;
      sessionControls.rearmForceExitTimer = () => {
        if (forceExitTimer) clearTimeout(forceExitTimer);
        forceExitTimer = setTimeout(forceExit, 5000);
        forceExitTimer.unref?.();
      };
      sessionControls.forceExit = forceExit;
    }),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServiceDescriptorMapLive(services),
        DevRuntimeConfigLive(runtimeConfig),
        DevGeneratedEnvLive(envGenerated),
        ShellEnvLive(shellEnv),
      ),
    ),
    Effect.catchDefect((defect) =>
      Effect.logError("[Dev] Unhandled defect in orchestrator:", defect).pipe(
        Effect.andThen(Effect.die(defect)),
      ),
    ),
  );

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  void Effect.runPromiseExit(program)
    .then((exit) => {
      clearInterval(orphanWatch);
      if (forceExitTimer) clearTimeout(forceExitTimer);
      process.exit(Exit.isSuccess(exit) ? 0 : 1);
    })
    .catch((error: unknown) => {
      clearInterval(orphanWatch);
      if (forceExitTimer) clearTimeout(forceExitTimer);
      console.error("[Dev] Failed to observe application exit:", error);
      process.exit(1);
    });
};

export const devApp = runApp;

export const startApp = runApp;
