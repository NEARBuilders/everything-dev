import path from "node:path";
import { Clock, DateTime, Deferred, Effect, Exit, Fiber, Layer, type Scope, Stream } from "effect";
import { getProcessEnv } from "../../env/process-env";
import { ShellEnvLive } from "../../env/project-env";
import { ownerOfPort } from "../../infra/port-ownership";
import { probePortBindable } from "../../infra/ports";
import type { RuntimeConfig } from "../../types";
import { SupervisorLive } from "../boot/adapters";
import { localReadinessSchedule, probeOk, remoteReadinessSchedule } from "../boot/readiness";
import { BootFailure } from "../boot/types";
import {
  type ProcessCallbacks,
  type ProcessStatus,
  Supervisor,
  type UnitEvent,
  type UnitHandle,
  type UnitSpec,
} from "../boot/units";
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
  type AdoptState,
  advanceAdopt,
  type BackendDistFingerprint,
  createBackendFingerprintSampler,
  DEV_ADOPT_POLL_MS,
  DEV_ADOPT_SETTLE_MS,
  initialAdoptState,
} from "./adopt";
import {
  createDevLogger,
  createLogPipeline,
  formatLogLine,
  isDebug,
  type LogEvent,
  type LogPipeline,
  resolveLogLevel,
} from "./logs";
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

let forceExitInFlight = false;
const markForceExitInFlight = () => {
  forceExitInFlight = true;
};

const realConsoleError = console.error.bind(console);

process.on("unhandledRejection", (reason) => {
  realConsoleError("[Orchestrator] Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  realConsoleError("[Orchestrator] Uncaught exception:", err);
  if (forceExitInFlight) process.exit(1);
});

export interface ProcessState {
  name: string;
  status: ProcessStatus;
  port: number;
  message?: string;
  source?: "local" | "remote";
  uiPort?: number;
}

export function getProcessStates(
  packages: string[],
  services: Map<string, ServiceDescriptor>,
  portOverride?: number,
): ProcessState[] {
  return packages.map((pkg) => {
    const descriptor = services.get(pkg);
    return {
      name: pkg,
      status: "pending" as const,
      port:
        portOverride && pkg === "host"
          ? portOverride
          : (descriptor?.port ?? descriptor?.defaultPort ?? 0),
      source: descriptor?.source,
      uiPort: descriptor?.uiPort,
    };
  });
}

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

export interface DevSessionHandle {
  shutdown: (mode: "graceful" | "force") => void;
}

export interface DevSessionDeps {
  exit?: (code: number) => void;
  forceTimeoutMs?: number;
  reap?: (pid: number) => void;
  ppid?: () => number;
  /** Test seam: scale the readiness deadline down (real HTTP probes against
   * nothing would otherwise burn the full window in unit tests). */
  readinessDeadlineMs?: number;
  /** Test seam: base backoff for the development restart schedule. */
  restartBackoffMs?: number;
}

/**
 * Operator override for the per-unit readiness deadline (milliseconds).
 * Default windows assume warm builds; a cold first boot on a loaded machine
 * can exceed them, so `BOS_READINESS_DEADLINE_MS` stretches every unit's
 * window without touching the defaults.
 */
const envReadinessDeadlineMs = (): number | null => {
  const raw = getProcessEnv("BOS_READINESS_DEADLINE_MS");
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

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
    const orderedPackages = [...new Set(orchestrator.packages)];
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
      if (runtimeConfig.api.source === "local") addPort("api", runtimeConfig.api.port);
      if (runtimeConfig.ui.source === "local") addPort("ui", runtimeConfig.ui.port);
      if (runtimeConfig.auth?.source === "local") addPort("auth", runtimeConfig.auth.port);
      if (runtimeConfig.plugins) {
        for (const [id, plugin] of Object.entries(runtimeConfig.plugins)) {
          if (
            plugin.source === "local" &&
            !isAuthMirrorPluginEntry(runtimeConfig.auth, id, plugin)
          ) {
            addPort(`plugin:${id}`, plugin.port);
          }
          if (plugin.ui?.source === "local") addPort(`plugin-ui:${id}`, plugin.ui.port);
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
    const startFailures: string[] = [];
    const readyUnits = new Set<string>();
    const exitedBeforeReady = new Set<string>();
    const handles = new Map<string, UnitHandle>();
    const pipeline = createLogPipeline({
      level: logLevel,
      sinks: {
        display: (event) => {
          view?.addLog(event.source, event.line, event.level === "error");
        },
        file: (event) => {
          // Log persistence is a development surface — production stacks
          // stream to stdout (captured by the smoke) and skip the file sink
          // entirely: the SSR host's serialized appendFile chain starves the
          // event loop under load (ADR 0048).
          if (runtimeConfig.env !== "development") return;
          void logger.write(event);
        },
        export: (event) => {
          allLogs.push(event);
        },
      },
    });

    // The TUI is a development surface; production stacks render plain,
    // streaming lines (ADR 0048).
    const useInteractive = runtimeConfig.env === "development" && isInteractiveSupported();
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
      for (const handle of handles.values()) {
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
    let forceFiber: Fiber.Fiber<void, never> | null = null;
    const armForce = Effect.gen(function* () {
      const existing = forceFiber;
      forceFiber = null;
      if (existing) yield* Fiber.interrupt(existing);
      // forkDetach: the backstop must survive the scope's close — forkScoped
      // inside a finalizer attaches to the closing scope and dies with it.
      forceFiber = yield* Effect.forkDetach(
        Effect.sleep(forceTimeoutMs).pipe(Effect.andThen(Effect.sync(force))),
      );
    });
    const disarmForce = Effect.gen(function* () {
      const existing = forceFiber;
      forceFiber = null;
      if (existing) yield* Fiber.interrupt(existing);
    });

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
        void Effect.runPromiseWith(effectContext)(armForce);
        void Effect.runPromiseWith(effectContext)(Deferred.succeed(shutdown, undefined));
      },
    };
    handleRef = sessionHandle;

    yield* Effect.addFinalizer(() => disarmForce);

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* armForce;

        yield* Effect.forEach(
          [...handles.values()],
          (h) => h.terminate("graceful").pipe(Effect.ignore),
          { concurrency: "unbounded" },
        );

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
          yield* Effect.logError(
            "[Dev] Parent process died — force exiting (orphaned service tree)",
          );
          force();
        }
      }),
    );

    onSessionReady?.(sessionHandle);

    const supervisor = yield* Supervisor;
    const readinessDeadlineMs = deps.readinessDeadlineMs ?? envReadinessDeadlineMs();

    const unitSpecFor = (pkg: string): UnitSpec => {
      const descriptor = services.get(pkg)!;
      const phase = pkg === "host" ? 2 : 1;
      const port =
        pkg === "host" && orchestrator.port
          ? orchestrator.port
          : (descriptor.port ?? descriptor.defaultPort);
      if (pkg === "host" && descriptor.source === "remote") {
        return {
          name: pkg,
          phase,
          payload: { _tag: "host-module", remoteUrl: descriptor.url, port },
          readiness: {
            urls: [`http://127.0.0.1:${port}/health`],
            deadlineMs: readinessDeadlineMs ?? 180_000,
          },
        };
      }
      if (descriptor.source !== "local" || !descriptor.localPath) {
        const baseUrl = descriptor.url.replace(/\/$/, "");
        const manifestUrl = `${baseUrl}/mf-manifest.json`;
        const probeUrl =
          descriptor.readinessUrl ??
          (descriptor.readinessPath === "/health" ? `${baseUrl}/health` : manifestUrl);
        return {
          name: pkg,
          phase,
          payload: { _tag: "probe", url: baseUrl },
          readiness: {
            urls: [probeUrl, `${baseUrl}${descriptor.readinessPath}`],
            method: descriptor.readinessMethod,
            deadlineMs: readinessDeadlineMs ?? 60_000,
          },
        };
      }
      return {
        name: pkg,
        phase,
        payload: {
          _tag: "process",
          command: descriptor.command ?? "pnpm",
          args: descriptor.args ?? ["run", "dev"],
          cwd: descriptor.localPath,
          port,
          env: descriptor.env,
        },
        readiness: {
          urls: [`http://127.0.0.1:${port}${descriptor.readinessPath}`],
          deadlineMs: readinessDeadlineMs ?? 90_000,
        },
      };
    };

    const MAX_UNIT_RESTARTS = 3;
    const restartAttempts = new Map<string, number>();
    const restartBackoffMs = deps.restartBackoffMs ?? 1_000;

    const pumpUnitEvents = (
      spec: UnitSpec,
      handle: UnitHandle,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.forkScoped(
        Stream.runForEach((event: UnitEvent) =>
          Effect.gen(function* () {
            const pkg = spec.name;
            if (handles.get(pkg) !== handle) return;
            if (event.type === "log") {
              callbacks.onLog(pkg, event.line, event.stderr);
              return;
            }
            if (!readyUnits.has(pkg)) {
              startFailures.push(pkg);
              exitedBeforeReady.add(pkg);
              callbacks.onLog(pkg, `Process exited before ready (code ${event.code})`, true);
              callbacks.onStatus(pkg, "error");
              return;
            }
            if (runtimeConfig.env !== "development") {
              // production units never restart — a dead unit is a loud,
              // visible failure (and the host unit fails the session itself)
              callbacks.onLog(pkg, `Process exited after ready (code ${event.code})`, true);
              callbacks.onStatus(pkg, "error", "exited");
              return;
            }
            const attempts = restartAttempts.get(pkg) ?? 0;
            if (attempts >= MAX_UNIT_RESTARTS) {
              callbacks.onLog(
                pkg,
                `restart limit reached (${MAX_UNIT_RESTARTS}) — ${pkg} stays down`,
                true,
              );
              callbacks.onStatus(pkg, "error", "restart limit");
              return;
            }
            const attempt = attempts + 1;
            restartAttempts.set(pkg, attempt);
            readyUnits.delete(pkg);
            const delay = restartBackoffMs * 2 ** (attempt - 1);
            callbacks.onLog(pkg, `restarting (attempt ${attempt})`, false);
            callbacks.onStatus(pkg, "starting", `restarting (attempt ${attempt})`);
            yield* Effect.forkScoped(
              Effect.sleep(`${delay} millis`).pipe(Effect.andThen(startUnit(spec.name))),
            );
          }),
        )(handle.events),
      );

    const awaitUnitReady = (spec: UnitSpec) =>
      Effect.gen(function* () {
        const schedule =
          spec.payload._tag === "process" ? localReadinessSchedule : remoteReadinessSchedule;
        // deadline as a race, not a timeout: the poll is display-adjacent and
        // must never fail — false just means the deadline lapsed.
        const ready = yield* Effect.race(
          Effect.repeat(
            Effect.gen(function* () {
              if (readyUnits.has(spec.name) || exitedBeforeReady.has(spec.name)) return true;
              const ok = yield* probeOk(spec.readiness.urls, spec.readiness.method);
              if (ok) {
                readyUnits.add(spec.name);
                callbacks.onStatus(spec.name, "ready");
                return true;
              }
              return false;
            }),
            { schedule, until: (done) => done },
          ).pipe(Effect.as(true)),
          Effect.sleep(`${spec.readiness.deadlineMs} millis`).pipe(Effect.as(false)),
        );
        if (ready) return;
        if (!readyUnits.has(spec.name) && !exitedBeforeReady.has(spec.name)) {
          startFailures.push(spec.name);
          callbacks.onLog(spec.name, `Readiness deadline exceeded: ${spec.name}`, true);
          callbacks.onStatus(spec.name, "error", "readiness deadline");
        }
      });

    const startUnit = (pkg: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const spec = unitSpecFor(pkg);
        const handle = yield* supervisor.spawn(spec).pipe(
          Effect.tapError((err) =>
            Effect.sync(() => {
              startFailures.push(pkg);
              callbacks.onLog(pkg, `Failed to start: ${err.message}`, true);
              callbacks.onStatus(pkg, "error");
            }),
          ),
          Effect.orElseSucceed(() => null),
        );
        if (handle === null) return;
        handles.set(pkg, handle);
        yield* pumpUnitEvents(spec, handle);
        yield* awaitUnitReady(spec);
      });

    const startGroup = (packages: string[]) =>
      Effect.forEach(packages, startUnit, { concurrency: "unbounded" });

    const replaceUnit = (pkg: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const handle = handles.get(pkg);
        if (handle) {
          handles.delete(pkg);
          yield* handle.terminate("graceful").pipe(Effect.ignore);
          readyUnits.delete(pkg);
          exitedBeforeReady.delete(pkg);
        }
        restartAttempts.delete(pkg);
        yield* startUnit(pkg);
      });

    const startupPhase = Effect.gen(function* () {
      yield* startGroup(orderedPackages.filter((pkg) => pkg !== "host"));
      yield* startGroup(orderedPackages.filter((pkg) => pkg === "host"));
    });

    const startup = yield* Effect.raceFirst(
      startupPhase,
      Deferred.await(shutdown).pipe(Effect.as(null)),
    );

    if (startup === null) return;

    const allHandles = [...handles.values()];

    // KEEP: production-like boots (start command — the runtime image's PID 1)
    // fail non-zero when any service failed to start or never became ready,
    // so the container itself is the boot verdict: the deploy smoke's exit
    // watch resolves in seconds and a wedged stack can never idle past its
    // probe deadline. Development sessions tolerate a partial start — the
    // orElseSucceed dummy handle above keeps the session alive there on
    // purpose. A failed session runs the normal finalizer chain (kills the
    // remaining services, flushes the log pipeline), and runApp maps the
    // failure to exit 1. Before this, the 2026-11-20 rc.46 train sat its
    // full 240s smoke deadline on a boot that had died in the first second.
    const strictBoot = runtimeConfig.env !== "development";
    if (strictBoot && startFailures.length > 0) {
      const failure = new BootFailure({ failed: [...startFailures] });
      yield* Effect.logError(`[Dev] ${failure.message}`);
      return yield* failure;
    }

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

    yield* forkBackendAdopt({
      configDir,
      services,
      runtimeConfig,
      replaceUnit,
      pipeline,
    });

    yield* Deferred.await(shutdown);
  });

/**
 * The dev supervisor's backend adopt loop (issue #942): watch the built dists
 * of the local `api`, `auth`, and `plugin:*` children with the shared settle
 * state machine, and on a stable generation move REPLACE the affected child
 * through the spawn machinery (`replaceUnit` — the same path a crash restart
 * takes). The child replacement refreshes the child's own serving surface;
 * the host's dev adopt (host/src/services/dev-plugin-adopt.ts) is the plane
 * that moves host-mediated serving — the two watchers share the fingerprint
 * and settle semantics from `./adopt`, and stay otherwise independent.
 * Development only: production stacks never adopt (a dead unit stays a loud
 * failure there, ADR 0048).
 */
const forkBackendAdopt = (input: {
  configDir: string;
  services: Map<string, ServiceDescriptor>;
  runtimeConfig: RuntimeConfig;
  replaceUnit: (pkg: string) => Effect.Effect<void, never, Scope.Scope>;
  pipeline: LogPipeline;
}): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    if (input.runtimeConfig.env !== "development") return;

    const samplers = new Map<string, () => Promise<BackendDistFingerprint | null>>();
    const labels = new Map<string, string>();
    for (const [key, descriptor] of input.services.entries()) {
      if (descriptor.source !== "local" || !descriptor.localPath) continue;
      if (key !== "api" && key !== "auth" && !key.startsWith("plugin:")) continue;
      samplers.set(key, createBackendFingerprintSampler(descriptor.localPath));
      const relative = path.relative(input.configDir, descriptor.localPath);
      labels.set(
        key,
        relative && !relative.startsWith("..") ? relative : path.basename(descriptor.localPath),
      );
    }
    if (samplers.size === 0) return;

    let state: AdoptState = initialAdoptState;
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(`${DEV_ADOPT_POLL_MS} millis`);
          const outcome = yield* Effect.gen(function* () {
            const observations = [];
            for (const [key, sample] of samplers) {
              observations.push({ key, fingerprint: yield* Effect.promise(sample) });
            }
            const advanced = advanceAdopt(state, {
              now: Date.now(),
              settleMs: DEV_ADOPT_SETTLE_MS,
              observations,
            });
            for (const move of advanced.moves) {
              yield* input.replaceUnit(move.key);
              input.pipeline.ingest({
                source: "dev",
                line: `${labels.get(move.key) ?? move.key} moved to generation ${move.generation}`,
                level: "warn",
              });
              input.pipeline.flushSource("dev");
            }
            return advanced.state;
          }).pipe(
            Effect.catchDefect((defect) =>
              Effect.logError("[Dev] backend adopt tick failed:", defect).pipe(Effect.as(state)),
            ),
          );
          state = outcome;
        }
      }),
    );
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
        SupervisorLive({
          generatedEnv: data.envGenerated,
          shellTier: data.shellEnv,
          runtimeConfig: data.runtimeConfig,
        }),
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
