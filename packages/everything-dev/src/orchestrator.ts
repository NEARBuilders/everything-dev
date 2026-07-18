import { Command } from "@effect/platform";
import type { ExitCode } from "@effect/platform/CommandExecutor";
import { Deferred, Effect, Option, Ref, Stream } from "effect";
import { patchManifestFetchForSsrPublicPath } from "./mf";
import {
  DevRuntimeConfig,
  type ServiceDescriptor,
  ServiceDescriptorMap,
} from "./service-descriptor";
import type { RuntimeConfig } from "./types";

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
  waitForExit: Effect.Effect<ExitCode, unknown>;
}

export type ProcessStatus = "pending" | "starting" | "ready" | "error";

export interface ProcessState {
  name: string;
  status: ProcessStatus;
  port: number;
  message?: string;
  source?: "local" | "remote";
}

const stripAnsi = (input: string): string => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  return input
    .replace(new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
};

const probeHttpOk = (url: string, timeoutMs = 400) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        return res.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    catch: () => false,
  });

const LOCAL_PROBE_DEADLINE_MS = 90_000;
const LOCAL_PROBE_INTERVAL_MS = 200;

const REMOTE_PROBE_TIMEOUT_MS = 5000;
const REMOTE_PROBE_DEADLINE_MS = 60_000;
const REMOTE_PROBE_BACKOFF_INITIAL_MS = 1000;
const REMOTE_PROBE_BACKOFF_MAX_MS = 15_000;

const detectStatus = (
  line: string,
  descriptor: ServiceDescriptor,
): { status: ProcessStatus; isError: boolean } | null => {
  const cleanLine = stripAnsi(line);
  const errorPatterns = descriptor.errorPatterns ?? [];
  const readyPatterns = descriptor.readyPatterns ?? [];
  for (const pattern of errorPatterns) {
    if (pattern.test(cleanLine)) {
      return { status: "error", isError: true };
    }
  }
  for (const pattern of readyPatterns) {
    if (pattern.test(cleanLine)) {
      return { status: "ready", isError: false };
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

const spawnRemoteHost = (descriptor: ServiceDescriptor, callbacks: ProcessCallbacks) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* DevRuntimeConfig;
    const remoteUrl = descriptor.remoteUrl;
    if (!remoteUrl) {
      return yield* Effect.fail(new Error("remoteUrl not provided on host descriptor"));
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
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10_000);
          let res: Response;
          try {
            res = await fetch(manifestUrl, { signal: controller.signal });
          } finally {
            clearTimeout(timer);
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
        } catch {}
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
      return yield* Effect.fail(new Error("Host module does not export runServer function"));
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
      pid: process.pid,
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

const spawnDevProcess = (descriptor: ServiceDescriptor, callbacks: ProcessCallbacks) =>
  Effect.gen(function* () {
    const runtimeConfig = yield* DevRuntimeConfig;

    if (!descriptor.localPath) {
      return yield* Effect.fail(new Error(`No localPath for local service: ${descriptor.key}`));
    }

    const fullCwd = descriptor.localPath;
    const command = descriptor.command ?? "bun";
    const args = descriptor.args ?? ["run", "dev"];
    const port = descriptor.port ?? descriptor.defaultPort;
    const name = descriptor.key;

    const readyDeferred = yield* Deferred.make<void, Error>();
    const statusRef = yield* Ref.make<ProcessStatus>("starting");

    callbacks.onStatus(name, "starting");

    const envVars: Record<string, string> = {
      ...(process.env as Record<string, string>),
      FORCE_COLOR: "1",
      ...(port > 0 ? { PORT: String(port) } : {}),
    };

    if (name === "host") {
      envVars.BOS_RUNTIME_CONFIG = JSON.stringify(runtimeConfig);
    }

    const cmd = Command.make(command, ...args).pipe(
      Command.workingDirectory(fullCwd),
      Command.env(envVars),
    );

    const proc = yield* Command.start(cmd);

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
        const deadline = Date.now() + LOCAL_PROBE_DEADLINE_MS;

        if (port > 0) {
          const readinessPath = descriptor.readinessPath;
          const url = `http://127.0.0.1:${port}${readinessPath}`;
          while (Date.now() < deadline) {
            const status = yield* Ref.get(statusRef);
            if (status === "ready" || status === "error") return;
            const ok = yield* probeHttpOk(url);
            if (ok) {
              yield* markReady;
              return;
            }
            yield* Effect.sleep(`${LOCAL_PROBE_INTERVAL_MS} millis`);
          }
        } else {
          while (Date.now() < deadline) {
            const status = yield* Ref.get(statusRef);
            if (status === "ready" || status === "error") return;
            yield* Effect.sleep("500 millis");
          }
        }

        const status = yield* Ref.get(statusRef);
        if (status !== "ready" && status !== "error") {
          callbacks.onLog(name, "Probe deadline exceeded after 90s", true);
          yield* markError(`Probe deadline exceeded: ${name}`);
        }
      }),
    );

    const pid = Number(proc.pid);

    yield* Effect.forkScoped(
      Effect.gen(function* () {
        const exitCode = yield* proc.exitCode;
        const currentStatus = yield* Ref.get(statusRef);
        if (currentStatus === "ready" || currentStatus === "error") return;
        callbacks.onLog(name, `Process exited before ready (exit code: ${exitCode})`, true);
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
          !/^\$/.test(cleanLine);
        callbacks.onLog(name, line, looksLikeError);

        const currentStatus = yield* Ref.get(statusRef);
        if (currentStatus === "ready" || currentStatus === "error") return;

        const detected = detectStatus(line, descriptor);
        if (detected) {
          if (detected.status === "ready") {
            yield* markReady;
          } else {
            yield* markError(`Process failed: ${name}`);
          }
        }
      });

    yield* Effect.forkScoped(
      Stream.runForEach((line: string) => handleLine(line, false))(
        Stream.splitLines(Stream.decodeText(proc.stdout, "utf-8")),
      ),
    );

    yield* Effect.forkScoped(
      Stream.runForEach((line: string) => handleLine(line, true))(
        Stream.splitLines(Stream.decodeText(proc.stderr, "utf-8")),
      ),
    );

    return {
      name,
      pid,
      kill: Effect.gen(function* () {
        const result = yield* proc.kill("SIGTERM").pipe(Effect.timeout("3 seconds"), Effect.option);
        if (Option.isNone(result)) {
          const pid = Number(proc.pid);
          yield* Effect.try(() => process.kill(-pid, "SIGKILL")).pipe(Effect.ignore);
          yield* Effect.sleep("250 millis");
        }
      }).pipe(Effect.ignore),
      waitForReady: Deferred.await(readyDeferred),
      waitForExit: proc.exitCode,
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
        const deadline = Date.now() + REMOTE_PROBE_DEADLINE_MS;
        let delay = REMOTE_PROBE_BACKOFF_INITIAL_MS;
        while (Date.now() < deadline) {
          const status = yield* Ref.get(statusRef);
          if (status === "ready" || status === "error") return;

          const ok = yield* probeHttpOk(probeUrl, REMOTE_PROBE_TIMEOUT_MS);

          if (ok) {
            yield* markReady;
            return;
          }

          const fallbackOk = yield* probeHttpOk(entryUrl, REMOTE_PROBE_TIMEOUT_MS);

          if (fallbackOk) {
            yield* markReady;
            return;
          }

          yield* Effect.sleep(`${delay} millis`);
          delay = Math.min(Math.round(delay * 1.5), REMOTE_PROBE_BACKOFF_MAX_MS);
        }

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
    };
  });
}
