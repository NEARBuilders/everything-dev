import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { Data, Deferred, Effect, Option, Ref, Schedule, Stream } from "effect";
import { stripAnsi } from "./dev-log-pipeline";
import { ShellEnv } from "./env/project-env";
import { patchManifestFetchForSsrPublicPath } from "./mf";
import {
  DevGeneratedEnv,
  DevRuntimeConfig,
  type ServiceDescriptor,
  ServiceDescriptorMap,
} from "./service-descriptor";
import type { RuntimeConfig } from "./types";

const warnOutsideEffect = (...args: unknown[]): void => {
  console.warn(...args);
};

const runFetch = (url: string, init?: RequestInit): Promise<Response> => fetch(url, init);

process.on("unhandledRejection", (reason) => {
  console.error("[Orchestrator] Unhandled rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Orchestrator] Uncaught exception:", err);
});

export interface ProcessCallbacks {
  onStatus: (name: string, status: ProcessStatus, message?: string) => void;
  onLog: (name: string, line: string, isError?: boolean) => void;
}

export interface ProcessHandle {
  name: string;
  pid: number | undefined;
  kill: Effect.Effect<void, unknown>;
  waitForReady: Effect.Effect<void, Error>;
  waitForExit: Effect.Effect<number, unknown>;
}

export type ProcessStatus = "pending" | "starting" | "ready" | "error";

export interface ProcessState {
  name: string;
  status: ProcessStatus;
  port: number;
  message?: string;
  source?: "local" | "remote";
  uiPort?: number;
}

const probeHttpOk = (url: string, timeoutMs = 400) =>
  Effect.tryPromise({
    try: async () => {
      try {
        const res = await runFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok;
      } catch {
        return false;
      }
    },
    catch: () => false,
  });

const LOCAL_PROBE_DEADLINE_MS = 90_000;
const LOCAL_PROBE_INTERVAL_MS = 200;

const cleanExitSignals: Record<string, true> = { SIGTERM: true, SIGINT: true };

const REMOTE_PROBE_TIMEOUT_MS = 5000;
const REMOTE_PROBE_DEADLINE_MS = 60_000;
const REMOTE_PROBE_BACKOFF_INITIAL_MS = 1000;
const REMOTE_PROBE_BACKOFF_MAX_MS = 15_000;

export const detectStatus = (
  line: string,
  descriptor: ServiceDescriptor,
): { status: ProcessStatus; isError: boolean } | null => {
  const cleanLine = stripAnsi(line);
  const errorPatterns = descriptor.errorPatterns ?? [];
  const readyPatterns = descriptor.readyPatterns ?? [];
  for (const pattern of readyPatterns) {
    if (pattern.test(cleanLine)) {
      return { status: "ready", isError: false };
    }
  }
  for (const pattern of errorPatterns) {
    if (pattern.test(cleanLine)) {
      return { status: "error", isError: true };
    }
  }
  return null;
};

interface ServerHandle {
  ready: Promise<void>;
  shutdown: () => Promise<void>;
}

interface ServerInput {
  config: RuntimeConfig;
  port?: number;
  env?: Record<string, string>;
}

const patchConsole = (name: string, callbacks: ProcessCallbacks): (() => void) => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  const formatArgs = (args: unknown[], isError = false): string => {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          const parts = [`${arg.name}: ${arg.message}`];
          if (arg.cause instanceof Error)
            parts.push(`(cause: ${arg.cause.name}: ${arg.cause.message})`);
          else if (arg.cause) parts.push(`(cause: ${String(arg.cause)})`);
          if (isError && arg.stack) parts.push(arg.stack);
          return parts.join("\n");
        }
        return typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg);
      })
      .join(" ");
  };

  console.log = (...args: unknown[]) => {
    callbacks.onLog(name, formatArgs(args), false);
  };
  console.error = (...args: unknown[]) => {
    callbacks.onLog(name, formatArgs(args, true), true);
  };
  console.warn = (...args: unknown[]) => {
    callbacks.onLog(name, formatArgs(args), false);
  };
  console.info = (...args: unknown[]) => {
    callbacks.onLog(name, formatArgs(args), false);
  };

  return () => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
  };
};

export class HostRemoteUrlMissing extends Data.TaggedError("HostRemoteUrlMissing")<
  Record<never, never>
> {
  get message() {
    return "remoteUrl not provided on host descriptor";
  }
}

export class HostModuleInvalid extends Data.TaggedError("HostModuleInvalid")<Record<never, never>> {
  get message() {
    return "Host module does not export runServer function";
  }
}

export class LocalPathMissing extends Data.TaggedError("LocalPathMissing")<{ key: string }> {
  get message() {
    return `No localPath for local service: ${this.key}`;
  }
}

const spawnRemoteHost = (descriptor: ServiceDescriptor, callbacks: ProcessCallbacks) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* DevRuntimeConfig;
    const remoteUrl = descriptor.remoteUrl;
    if (!remoteUrl) {
      return yield* new HostRemoteUrlMissing();
    }

    callbacks.onStatus(descriptor.key, "starting");
    callbacks.onLog(descriptor.key, `Remote: ${remoteUrl}`);
    const restoreConsole = patchConsole(descriptor.key, callbacks);
    callbacks.onLog(descriptor.key, "Loading Module Federation runtime...");

    const mfRuntime = yield* Effect.tryPromise({
      try: () => import("@module-federation/enhanced/runtime"),
      catch: (e) => new Error(`Failed to load MF runtime: ${e}`),
    });

    const mfCore = yield* Effect.tryPromise({
      try: () => import("@module-federation/runtime-core"),
      catch: (e) => new Error(`Failed to load MF core: ${e}`),
    });

    let mf = mfRuntime.getInstance();
    if (!mf) {
      mf = mfRuntime.createInstance({ name: "cli-host", remotes: [] });
      mfCore.setGlobalFederationInstance(mf);
    }
    patchManifestFetchForSsrPublicPath(mf as any);

    const baseUrl = remoteUrl
      .replace(/\/remoteEntry\.js$/, "")
      .replace(/\/mf-manifest\.json$/, "")
      .replace(/\/$/, "");
    const remoteEntryUrl = `${baseUrl}/remoteEntry.js`;
    const manifestUrl = `${baseUrl}/mf-manifest.json`;

    const entryUrl = yield* Effect.tryPromise({
      try: async () => {
        try {
          let res: Response;
          try {
            res = await runFetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
          } catch {
            throw new Error("manifest fetch failed");
          }
          if (!res.ok) return remoteEntryUrl;
          const json = (await res.json()) as Record<string, unknown>;
          if (
            json &&
            typeof json === "object" &&
            "metaData" in json &&
            "exposes" in json &&
            "shared" in json
          ) {
            return manifestUrl;
          }
        } catch (e) {
          warnOutsideEffect(
            `[Orchestrator] Failed to fetch or parse manifest from ${manifestUrl}, falling back to remoteEntryUrl: ${e}`,
          );
        }
        return remoteEntryUrl;
      },
      catch: () => remoteEntryUrl,
    });

    (mf as any).registerRemotes([{ name: "host", entry: entryUrl }]);
    callbacks.onLog(descriptor.key, `Loading host from ${entryUrl}...`);

    const hostModule = yield* Effect.tryPromise({
      try: () =>
        (mf as any).loadRemote("host/Server") as Promise<{
          runServer: (input: ServerInput) => ServerHandle;
        }>,
      catch: (e) => new Error(`Failed to load host module: ${e}`),
    });

    if (!hostModule?.runServer) {
      return yield* new HostModuleInvalid();
    }

    callbacks.onLog(descriptor.key, "Starting server...");
    const hostPort = runtimeConfig.host?.port;
    const hostEnv: Record<string, string> | undefined = hostPort
      ? { PORT: String(hostPort) }
      : undefined;
    const serverHandle = hostModule.runServer({
      config: runtimeConfig,
      port: hostPort,
      env: hostEnv,
    });
    yield* Effect.tryPromise({
      try: () => serverHandle.ready,
      catch: (e) => new Error(`Server failed to start: ${e}`),
    });

    callbacks.onStatus(descriptor.key, "ready");

    return {
      name: descriptor.key,
      pid: undefined,
      kill: Effect.gen(function* () {
        callbacks.onLog(descriptor.key, "Shutting down remote host...");
        restoreConsole();
        yield* Effect.tryPromise({
          try: () => serverHandle.shutdown(),
          catch: () => {},
        }).pipe(Effect.ignore);
      }),
      waitForReady: Effect.succeed(undefined),
      waitForExit: Effect.never,
    } satisfies ProcessHandle;
  });

/**
 * Spawn env precedence, three tiers: values explicitly exported by the
 * caller (shell / CI / regression harness — captured by the bootstrap
 * program into the `ShellEnv` service before any `.env` loading) outrank the
 * generated infra env, which outranks `.env`-file values inherited through
 * `processEnv`. The service's resolved port is always authoritative.
 */
export function composeSpawnEnv(
  processEnv: Record<string, string>,
  generatedEnv: Record<string, string>,
  port: number,
  shellEnv: Record<string, string> = {},
): Record<string, string> {
  return {
    ...processEnv,
    ...mergeGeneratedOverFileEnv(generatedEnv, processEnv, shellEnv),
    FORCE_COLOR: "1",
    ...(port > 0 ? { PORT: String(port) } : {}),
  };
}

/**
 * Overlay the generated infra env (ports drift, so stale `.env` values must
 * lose) while keeping every explicitly exported key from `shellEnv` intact.
 * Keys absent from both are untouched.
 *
 * Exception (ADR 0012 / plan 038): the origin keys BASE_URL and CORS_ORIGIN
 * are always generated-owned — a wrapper that sourced a stale `.env` must not
 * win over the resolved host port, in the child env or on disk.
 */
const GENERATED_OWNED_KEYS = new Set(["BASE_URL", "CORS_ORIGIN"]);

export function mergeGeneratedOverFileEnv(
  generatedEnv: Record<string, string>,
  processEnv: Record<string, string>,
  shellEnv: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = { ...processEnv };
  for (const [key, value] of Object.entries(generatedEnv)) {
    if (!GENERATED_OWNED_KEYS.has(key) && key in shellEnv) {
      result[key] = shellEnv[key]!;
    } else {
      result[key] = value;
    }
  }
  return result;
}

const spawnDevProcess = (descriptor: ServiceDescriptor, callbacks: ProcessCallbacks) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* DevRuntimeConfig;

    if (!descriptor.localPath) {
      return yield* new LocalPathMissing({ key: descriptor.key });
    }

    const fullCwd = descriptor.localPath;
    const command = descriptor.command ?? "bun";
    const baseArgs = descriptor.args ?? ["run", "dev"];
    // Source-first local dev: bun runtime chains (bun run → bin scripts →
    // bun children) inherit the conditions flag, so framework packages
    // (`every-plugin`, `everything-dev`) resolve their `development` export
    // condition — TS source — instead of a possibly stale dist. Node-based
    // children (tsx, rsbuild/rspack bins) ignore bun flags and keep dist
    // resolution except where they are TS-capable (see the host env below).
    const args = command === "bun" ? ["--conditions=development", ...baseArgs] : baseArgs;
    const port = descriptor.port ?? descriptor.defaultPort;
    const name = descriptor.key;

    const readyDeferred = yield* Deferred.make<void, Error>();
    const statusRef = yield* Ref.make<ProcessStatus>("starting");

    callbacks.onStatus(name, "starting");

    const generatedEnv = yield* DevGeneratedEnv;
    const shellTier = yield* ShellEnv;
    // The descriptor's env joins the generated tier — folding it in before
    // composeSpawnEnv keeps the documented precedence (shell > generated >
    // .env-file); assigning after would let it outrank the shell tier (and
    // the generated-owned keys) silently.
    const envVars = composeSpawnEnv(
      process.env as Record<string, string>,
      { ...generatedEnv, ...descriptor.env },
      port,
      shellTier,
    );

    envVars.BOS_RUNTIME_CONFIG = JSON.stringify(runtimeConfig);

    const cmd = spawn(command, args, {
      cwd: fullCwd,
      env: envVars,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    const exitCode = Effect.callback<number, Error>((resume) => {
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        lastExit = { code, signal };
        resume(Effect.succeed(code ?? (signal ? 1 : 0)));
      };
      const onError = (err: Error) => {
        callbacks.onLog(name, `Spawn failed: ${err.message}`, true);
        callbacks.onStatus(name, "error", `spawn failed: ${err.message}`);
        resume(Effect.fail(err));
      };
      cmd.once("exit", onExit);
      cmd.once("error", onError);
      return Effect.sync(() => {
        cmd.off("exit", onExit);
        cmd.off("error", onError);
      });
    });

    const describeExit = (exitCodeValue: number): string => {
      if (lastExit?.code === null && lastExit.signal) return `signal: ${lastExit.signal}`;
      return `exit code: ${exitCodeValue}`;
    };
    const isCleanSignalExit = (): boolean =>
      lastExit?.code === null && lastExit.signal != null && lastExit.signal in cleanExitSignals;

    const markReady = Effect.gen(function* () {
      const currentStatus = yield* Ref.get(statusRef);
      if (currentStatus === "ready" || currentStatus === "error") return;
      yield* Ref.set(statusRef, "ready");
      callbacks.onStatus(name, "ready");
      yield* Deferred.succeed(readyDeferred, undefined).pipe(Effect.ignore);
    });

    const markError = (message: string) =>
      Effect.gen(function* () {
        const currentStatus = yield* Ref.get(statusRef);
        if (currentStatus === "ready" || currentStatus === "error") return;
        yield* Ref.set(statusRef, "error");
        callbacks.onStatus(name, "error");
        yield* Deferred.fail(readyDeferred, new Error(message)).pipe(Effect.ignore);
      });

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const readinessPath = descriptor.readinessPath;
        const url = `http://127.0.0.1:${port}${readinessPath}`;
        const readinessCheck = Effect.gen(function* () {
          const status = yield* Ref.get(statusRef);
          if (status === "ready" || status === "error") return true;
          if (port <= 0) return false;
          const ok = yield* probeHttpOk(url);
          if (ok) yield* markReady;
          return ok;
        });
        const ready = yield* Effect.repeat(readinessCheck, {
          schedule: Schedule.spaced(`${port > 0 ? LOCAL_PROBE_INTERVAL_MS : 500} millis`),
          until: (done) => done,
        }).pipe(
          Effect.timeout(`${LOCAL_PROBE_DEADLINE_MS} millis`),
          Effect.catchTag("TimeoutError", () => Effect.succeed(false)),
        );
        if (ready) return;

        const status = yield* Ref.get(statusRef);
        if (status !== "ready" && status !== "error") {
          callbacks.onLog(name, "Probe deadline exceeded after 90s", true);
          yield* markError(`Probe deadline exceeded: ${name}`);
        }
      }),
    );

    const pid = cmd.pid ?? undefined;

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const exitCodeValue = yield* exitCode;
        const currentStatus = yield* Ref.get(statusRef);
        if (currentStatus === "ready" || currentStatus === "error") {
          // Post-ready exits must stay visible — a silently dead child (OOM
          // kill included) used to leave the stack answering with nothing.
          // A SIGTERM/SIGINT-signalled exit is the polite-quit path, not a
          // crash, so it logs as a plain shutdown line.
          if (currentStatus === "ready") {
            const detail = describeExit(exitCodeValue);
            callbacks.onLog(name, `Process exited after ready (${detail})`, !isCleanSignalExit());
            if (!isCleanSignalExit()) {
              callbacks.onStatus(name, "error", `exited after ready (${detail})`);
            }
            yield* markError(`Process exited after ready: ${name}`);
          }
          return;
        }
        callbacks.onLog(
          name,
          `Process exited before ready (${describeExit(exitCodeValue)})`,
          !isCleanSignalExit(),
        );
        yield* markError(`Process exited before ready: ${name}`);
      }),
    );

    const handleLine = (line: string, isStderr: boolean) =>
      Effect.gen(function* () {
        if (!line.trim()) return;

        const cleanLine = stripAnsi(line);
        const looksLikeError =
          isStderr &&
          /^(error|fail|fatal|exception|unhandled|reject)/i.test(cleanLine) &&
          !cleanLine.startsWith("$");
        callbacks.onLog(name, line, looksLikeError);

        const currentStatus = yield* Ref.get(statusRef);
        if (currentStatus === "ready") return;

        const detected = detectStatus(line, descriptor);
        if (detected) {
          if (detected.status === "ready") {
            yield* markReady;
          } else if (currentStatus !== "error") {
            yield* markError(`Process failed: ${name}`);
          }
        }
      });

    const stdoutStream = cmd.stdout
      ? (Readable.toWeb(cmd.stdout) as unknown as ReadableStream<Uint8Array>)
      : null;
    const stderrStream = cmd.stderr
      ? (Readable.toWeb(cmd.stderr) as unknown as ReadableStream<Uint8Array>)
      : null;

    if (stdoutStream) {
      yield* Effect.forkScoped(
        Stream.runForEach((line: string) => handleLine(line, false))(
          Stream.splitLines(
            Stream.decodeText(
              Stream.fromReadableStream({
                evaluate: () => stdoutStream,
                onError: (cause) => new Error(String(cause)),
              }),
            ),
          ),
        ),
      );
    }

    if (stderrStream) {
      yield* Effect.forkScoped(
        Stream.runForEach((line: string) => handleLine(line, true))(
          Stream.splitLines(
            Stream.decodeText(
              Stream.fromReadableStream({
                evaluate: () => stderrStream,
                onError: (cause) => new Error(String(cause)),
              }),
            ),
          ),
        ),
      );
    }

    return {
      name,
      pid,
      kill: Effect.gen(function* () {
        const groupPid = pid;
        const groupSignal = (signal: NodeJS.Signals) =>
          Effect.try(() => {
            if (groupPid !== undefined) process.kill(-groupPid, signal);
          }).pipe(Effect.ignore);
        yield* groupSignal("SIGTERM");
        const exited = yield* exitCode.pipe(Effect.timeout("3 seconds"), Effect.option);
        if (Option.isNone(exited)) {
          yield* groupSignal("SIGKILL");
          yield* Effect.sleep("250 millis");
        }
      }).pipe(Effect.ignore),
      waitForReady: Deferred.await(readyDeferred),
      waitForExit: exitCode,
    } satisfies ProcessHandle;
  });

const spawnRemoteProbe = (
  pkg: string,
  descriptor: ServiceDescriptor,
  callbacks: ProcessCallbacks,
) =>
  Effect.gen(function* () {
    callbacks.onStatus(pkg, "starting");
    const readyDeferred = yield* Deferred.make<void, Error>();
    const statusRef = yield* Ref.make<ProcessStatus>("starting");

    const markReady = Effect.gen(function* () {
      const currentStatus = yield* Ref.get(statusRef);
      if (currentStatus === "ready" || currentStatus === "error") return;
      yield* Ref.set(statusRef, "ready");
      yield* Deferred.succeed(readyDeferred, undefined).pipe(Effect.ignore);
      callbacks.onStatus(pkg, "ready", "loaded");
    });

    const markError = Effect.gen(function* () {
      const currentStatus = yield* Ref.get(statusRef);
      if (currentStatus === "ready" || currentStatus === "error") return;
      yield* Ref.set(statusRef, "error");
      yield* Deferred.fail(readyDeferred, new Error(`Remote ${pkg} unreachable`)).pipe(
        Effect.ignore,
      );
      callbacks.onStatus(pkg, "error", "unreachable");
    });

    const baseUrl = descriptor.url.replace(/\/$/, "");
    const manifestUrl = `${baseUrl}/mf-manifest.json`;
    const entryUrl = `${baseUrl}${descriptor.readinessPath}`;
    const probeUrl = descriptor.readinessPath === "/health" ? `${baseUrl}/health` : manifestUrl;

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const readinessCheck = Effect.gen(function* () {
          const status = yield* Ref.get(statusRef);
          if (status === "ready" || status === "error") return true;

          const ok = yield* probeHttpOk(probeUrl, REMOTE_PROBE_TIMEOUT_MS);
          if (ok) {
            yield* markReady;
            return true;
          }

          const fallbackOk = yield* probeHttpOk(entryUrl, REMOTE_PROBE_TIMEOUT_MS);
          if (fallbackOk) {
            yield* markReady;
            return true;
          }
          return false;
        });
        const ready = yield* Effect.repeat(readinessCheck, {
          schedule: Schedule.min([
            Schedule.exponential(`${REMOTE_PROBE_BACKOFF_INITIAL_MS} millis`, 1.5),
            Schedule.spaced(`${REMOTE_PROBE_BACKOFF_MAX_MS} millis`),
          ]),
          until: (done) => done,
        }).pipe(
          Effect.timeout(`${REMOTE_PROBE_DEADLINE_MS} millis`),
          Effect.catchTag("TimeoutError", () => Effect.succeed(false)),
        );
        if (ready) return;

        const status = yield* Ref.get(statusRef);
        if (status !== "ready") {
          yield* markError;
        }
      }),
    );

    return {
      name: pkg,
      pid: undefined,
      kill: Effect.gen(function* () {
        yield* Ref.set(statusRef, "error");
        yield* Deferred.fail(readyDeferred, new Error("Killed")).pipe(Effect.ignore);
      }),
      waitForReady: Deferred.await(readyDeferred),
      waitForExit: Effect.never,
    } satisfies ProcessHandle;
  });

export const makeDevProcess = (pkg: string, callbacks: ProcessCallbacks, portOverride?: number) =>
  Effect.gen(function* () {
    const services = yield* ServiceDescriptorMap;
    const descriptor = services.get(pkg);

    if (!descriptor) {
      callbacks.onStatus(pkg, "ready", "Remote");
      return {
        name: pkg,
        pid: undefined,
        kill: Effect.void,
        waitForReady: Effect.void,
        waitForExit: Effect.never,
      } satisfies ProcessHandle;
    }

    if (pkg === "host" && descriptor.source === "remote") {
      return yield* spawnRemoteHost(descriptor, callbacks);
    }

    if (descriptor.source === "remote" || !descriptor.localPath) {
      return yield* spawnRemoteProbe(pkg, descriptor, callbacks);
    }

    const resolvedDescriptor = portOverride ? { ...descriptor, port: portOverride } : descriptor;

    return yield* spawnDevProcess(resolvedDescriptor, callbacks);
  });

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
