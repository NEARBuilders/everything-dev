import { Clock, DateTime, Deferred, Effect, Exit, Layer } from "effect";
import { getProcessEnv } from "../../env/process-env";
import { ShellEnvLive } from "../../env/project-env";
import { ownerOfPort } from "../../infra/port-ownership";
import { probePortBindable } from "../../infra/ports";
import type { RuntimeConfig } from "../../types";
import { reapGroup } from "../processes/kill";
import {
  isPidAlive,
  readRegistry,
  registerStandalone,
  unregisterPid,
  updateChildPids,
  writeRegistry,
} from "../processes/registry";
import {
  createDevLogger,
  createLogPipeline,
  formatLogLine,
  isDebug,
  type LogEvent,
  resolveLogLevel,
} from "./logs";
import {
  getProcessStates,
  makeDevProcess,
  markForceExitInFlight,
  type ProcessCallbacks,
  type ProcessHandle,
} from "./orchestrator";
import { type DevProcessState, DevRenderer, type DevRendererHandle } from "./render";
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

export interface DevSessionHandle {
  shutdown: (mode: "graceful" | "force") => void;
}

export interface DevSessionDeps {
  exit?: (code: number) => void;
  forceTimeoutMs?: number;
  reap?: (pid: number) => void;
  ppid?: () => number;
}

export const runDevSession = (
  configDir: string,
  orchestrator: AppOrchestrator,
  onSessionReady?: (handle: DevSessionHandle) => void,
  deps: DevSessionDeps = {},
) =>
  Effect.gen(function* () {
    adoptOrphanedChildren(configDir);
    const services = yield* ServiceDescriptorMap;
    const runtimeConfig = yield* DevRuntimeConfig;
    const renderer = yield* DevRenderer;
    const orderedPackages = sortByOrder(orchestrator.packages);
    const initialProcesses: DevProcessState[] = getProcessStates(
      orderedPackages,
      services,
      orchestrator.port,
    );

    if (isDebug(getProcessEnv("DEBUG"))) {
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

    const exit = deps.exit ?? ((code: number) => process.exit(code));
    const reap = deps.reap ?? reapGroup;
    const forceTimeoutMs = deps.forceTimeoutMs ?? 5000;
    const ppidNow = deps.ppid ?? (() => process.ppid);

    const shutdown = yield* Deferred.make<void>();

    const effectContext = yield* Effect.context();

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
    const spawned: ProcessHandle[] = [];
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
    const restoreView = () => {
      if (useInteractive) view?.unmount();
    };
    let handleRef: DevSessionHandle | null = null;
    view = renderer.create(
      initialProcesses,
      orchestrator.description,
      orchestrator.env,
      () => handleRef?.shutdown("graceful"),
      () => {
        shouldExportLogs = true;
        handleRef?.shutdown("graceful");
      },
      { interactive: useInteractive, onForceExit: () => handleRef?.shutdown("force") },
    );

    const force = () => {
      markForceExitInFlight();
      try {
        restoreView();
      } catch {}
      try {
        pipeline.flush();
      } catch {}
      console.log("\n[Dev] Force exit");
      for (const handle of spawned) {
        if (handle.pid === undefined) continue;
        try {
          reap(handle.pid);
        } catch {}
      }
      if (!isWorkspaceChild) {
        try {
          unregisterPid(process.pid);
        } catch {}
      }
      void Effect.runPromiseWith(effectContext)(Deferred.succeed(shutdown, undefined));
      exit(0);
    };

    let gracefulCount = 0;
    let forceTimer: ReturnType<typeof setTimeout> | null = null;
    const armForce = () => {
      if (forceTimer) clearTimeout(forceTimer);
      forceTimer = setTimeout(force, forceTimeoutMs);
      forceTimer.unref?.();
    };
    const disarmForce = () => {
      if (forceTimer) clearTimeout(forceTimer);
      forceTimer = null;
    };

    const sessionHandle: DevSessionHandle = {
      shutdown: (mode) => {
        if (mode === "force") {
          force();
          return;
        }
        gracefulCount++;
        if (gracefulCount > 1) {
          force();
          return;
        }
        restoreView();
        console.log("\n[Dev] Shutting down...");
        armForce();
        void Effect.runPromiseWith(effectContext)(Deferred.succeed(shutdown, undefined));
      },
    };
    handleRef = sessionHandle;

    yield* Effect.addFinalizer(() => Effect.sync(disarmForce));

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        armForce();

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

    const callbacks: ProcessCallbacks = {
      onStatus: (name, status, message) => {
        // An error-status flip is the failure boundary — the failure message
        // logged just before it is still held in the pipeline's pending
        // multi-line buffer (events complete one line late). Drain it now so
        // the cause reaches the display tail and the log file even if the
        // process is SIGKILLed before the session finalizer can flush.
        if (status === "error") pipeline.flushSource(name);
        view?.updateProcess(name, status, message);
      },
      onLog: (name, line, isError) => {
        pipeline.ingest({ source: name, line, isError });
      },
    };

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const initialPpid = ppidNow();
        while (true) {
          yield* Effect.sleep("200 millis");
          if (ppidNow() === initialPpid) continue;
          console.error("\n[Dev] Parent process died — force exiting (orphaned service tree)");
          force();
        }
      }),
    );

    onSessionReady?.(sessionHandle);

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
  data: DevSessionData,
  rendererLayer: Layer.Layer<DevRenderer>,
) => {
  let handle: DevSessionHandle | null = null;
  const trigger = (mode: "graceful" | "force") => {
    if (handle) {
      handle.shutdown(mode);
      return;
    }
    process.exit(0);
  };

  process.on("SIGINT", () => trigger("graceful"));
  process.on("SIGTERM", () => trigger("graceful"));

  const program = Effect.scoped(
    runDevSession(configDir, data.orchestrator, (sessionHandle) => {
      handle = sessionHandle;
    }),
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServiceDescriptorMapLive(data.services),
        DevRuntimeConfigLive(data.runtimeConfig),
        DevGeneratedEnvLive(data.envGenerated),
        ShellEnvLive(data.shellEnv),
        rendererLayer,
      ),
    ),
    Effect.catchDefect((defect) =>
      Effect.logError("[Dev] Unhandled defect in orchestrator:", defect).pipe(
        Effect.andThen(Effect.die(defect)),
      ),
    ),
  );

  void Effect.runPromiseExit(program)
    .then((exit) => {
      process.exit(Exit.isSuccess(exit) ? 0 : 1);
    })
    .catch((error: unknown) => {
      console.error("[Dev] Failed to observe application exit:", error);
      process.exit(1);
    });
};

export const devApp = runApp;

export interface DevSessionData {
  orchestrator: AppOrchestrator;
  services: Map<string, ServiceDescriptor>;
  runtimeConfig: RuntimeConfig;
  /** The generated infra env tier — required so a start session can never silently run with an empty tier. */
  envGenerated: Record<string, string>;
  shellEnv: Record<string, string>;
}

export interface StartSummary {
  configSource: string;
  configSourceHttp?: string;
  account: string;
  domain?: string;
  modules: { host?: string; ui?: string; api?: string; auth?: string };
  warnings: string[];
}
