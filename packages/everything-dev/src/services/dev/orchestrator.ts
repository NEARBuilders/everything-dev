import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { Data, Deferred, Effect, Queue, Schedule, Schema, Stream } from "effect";
import { MANIFEST_DOCUMENT_PATTERN } from "every-plugin/ui/manifest/contract";
import { ShellEnv } from "../../env/project-env";
import type { RuntimeConfig } from "../../types";
import { fetchWithRetryEff } from "../../utils/http-client";
import { pinnedManifestDocumentUrl, resolveRemoteVersion } from "../deploy/version-manifest";
import { loadRemoteModule, registerRemote } from "../federation/service";
import { readInImagePlatformManifest } from "../platform/manifest";
import { stripAnsi } from "./logs";
import { type ServiceDescriptor, ServiceDescriptorMap } from "./service-descriptor";

let forceExitInFlight = false;

export const markForceExitInFlight = () => {
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

export interface ProcessCallbacks {
  onStatus: (name: string, status: ProcessStatus, message?: string) => void;
  onLog: (name: string, line: string, isError?: boolean) => void;
}

import type { UnitEvent } from "../boot/units";

/** A spawned unit, pre-bridge: the adapters assemble the public `UnitHandle`
 * (events stream, terminate) around this. Stdout is display-only — no
 * readiness, no error classification lives here (ADR 0048). */
export interface ProcessHandle {
  name: string;
  pid: number | undefined;
  events: Stream.Stream<UnitEvent>;
  terminate: (mode: "graceful" | "force") => Effect.Effect<void>;
}

export class OrchestratorError extends Data.TaggedError("OrchestratorError")<{
  readonly operation: string;
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message() {
    return `${this.operation}: ${this.detail}`;
  }
}

const omitUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : omitUndefined(item)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, omitUndefined(item)]),
    );
  }
  return value;
};

export const encodeRuntimeConfig = (runtimeConfig: unknown) =>
  Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Json))(omitUndefined(runtimeConfig)).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestratorError({
          operation: "serialize runtime config",
          detail: cause.message,
          cause,
        }),
    ),
  );

export type ProcessStatus = "pending" | "starting" | "ready" | "error";

export interface ProcessState {
  name: string;
  status: ProcessStatus;
  port: number;
  message?: string;
  source?: "local" | "remote";
  uiPort?: number;
}

// Effect-native probe — no nested Effect.runPromise: fetchRaw's promise
// bridge intermittently wedges when awaited from inside a running fiber
// (the readiness fork), stalling the whole boot until the 90s deadline.
const probeHttpOk = (url: string, timeoutMs = 400, method?: string) =>
  fetchWithRetryEff(url, { timeout: timeoutMs, retries: 0, ...(method ? { method } : {}) }).pipe(
    Effect.map((response) => response.ok),
    Effect.orElseSucceed(() => false),
  );

const LOCAL_PROBE_DEADLINE_MS = 90_000;

/** Remote-host boot budgets: every stage of the CDN-only boot is deadline-
 * bounded so a hung connection or a wedged module load fails loud with the
 * URL and stage — long before the smoke's 240s probe deadline turns the
 * silence into a mystery. */
const BOOT_FETCH_RETRIES = 2;
const BOOT_RETRY_WINDOW_MS = 5_000;

// KEEP: one policy shared by all three remote boot fetches — the schedule and
// the transient predicate must move together or the policy forks.
const BOOT_RETRY_SCHEDULE = Schedule.spaced("1 second").pipe(
  Schedule.upTo({ duration: BOOT_RETRY_WINDOW_MS, times: BOOT_FETCH_RETRIES }),
);

// KEEP: walks the whole cause chain, not one level — the fetch boundaries
// rewrap failures (resolveRemoteVersion rethrows as a plain `[SRI]` Error),
// and a one-level check silently never fires, which is exactly what this
// repo shipped first on the 2026-11-20 rc.46 train. The undici socket
// failure (`TypeError: fetch failed`) is the one boot error a second attempt
// within seconds actually fixes; skew, 404-shaped, and malformed-manifest
// failures won't heal in milliseconds and keep failing loud on the first
// attempt.
export const isTransientBootFailure = (error: OrchestratorError): boolean => {
  let cause: unknown = error.cause;
  for (let depth = 0; cause instanceof Error && depth < 5; depth += 1) {
    if (cause instanceof TypeError) return true;
    cause = cause.cause;
  }
  return false;
};

const MANIFEST_FETCH_DEADLINE = "10 seconds";
const LOAD_REMOTE_DEADLINE = "60 seconds";
const SERVER_READY_DEADLINE = "120 seconds";
const REMOTE_HOST_BOOT_DEADLINE = "180 seconds";
const LOCAL_PROBE_INTERVAL_MS = 200;

const cleanExitSignals: Record<string, true> = { SIGTERM: true, SIGINT: true };

const REMOTE_PROBE_TIMEOUT_MS = 5000;
const REMOTE_PROBE_DEADLINE_MS = 60_000;
const REMOTE_PROBE_BACKOFF_INITIAL_MS = 1000;
const REMOTE_PROBE_BACKOFF_MAX_MS = 15_000;

interface ServerHandle {
  ready: Promise<void>;
  shutdown: () => Promise<void>;
}

interface ServerInput {
  config: RuntimeConfig;
  port?: number;
  env?: Record<string, string>;
  /** The serving build's identity (#537) — the host remote answers
   * /.well-known/version with it. */
  platform?: {
    frameworkVersion: string;
    everyPluginVersion?: string;
    gitSha?: string;
    image?: { ref: string; tags: string[] };
  };
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
          else if (arg.cause) {
            const cause = arg.cause;
            parts.push(
              `(cause: ${cause instanceof Error ? cause.message : typeof cause === "string" ? cause : (JSON.stringify(cause) ?? "[Unserializable cause]")})`,
            );
          }
          if (isError && arg.stack) parts.push(arg.stack);
          return parts.join("\n");
        }
        if (arg === null) return "null";
        if (typeof arg === "string") return arg;
        if (typeof arg === "number" || typeof arg === "bigint" || typeof arg === "boolean")
          return `${arg}`;
        if (typeof arg === "symbol") return arg.description ?? "";
        if (typeof arg === "undefined") return "undefined";
        return JSON.stringify(arg, null, 2) ?? "[Unserializable value]";
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
  override get message() {
    return "remoteUrl not provided on host descriptor";
  }
}

export class HostModuleInvalid extends Data.TaggedError("HostModuleInvalid")<Record<never, never>> {
  override get message() {
    return "Host module does not export runServer function";
  }
}

export class LocalPathMissing extends Data.TaggedError("LocalPathMissing")<{ key: string }> {
  override get message() {
    return `No localPath for local service: ${this.key}`;
  }
}

/** The load-failure marker the shared-singleton resolver throws with — its
 * bare package error hides the drift story (#874), so the two plane
 * identities and the remediation ride the same failure detail. */
const SHARED_DEP_DRIFT_MARKER = "Could not resolve shared dependency";

function hostSkewRemediation(
  cause: unknown,
  image: ReturnType<typeof readInImagePlatformManifest>,
  digest: RuntimeConfig["host"]["digest"],
  remoteUrl: string,
): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!message.includes(SHARED_DEP_DRIFT_MARKER)) return "";
  return (
    "\nHost release skew — the host bundle's shared singletons do not resolve in this image:\n" +
    `  image: ${image?.frameworkVersion ?? "unknown"}\n` +
    `  pin:   ${digest ? `${digest.manifest} at ${remoteUrl}` : `${remoteUrl} (unpinned)`}\n` +
    "  fix:   bos upgrade && bos deploy — move the release pin and the image together"
  );
}

export const spawnRemoteHost = (
  input: { readonly key: string; readonly url: string; readonly runtimeConfig: RuntimeConfig },
  callbacks: ProcessCallbacks,
) =>
  Effect.gen(function* () {
    const runtimeConfig = input.runtimeConfig;
    const remoteUrl = input.url;
    if (!remoteUrl) {
      return yield* new HostRemoteUrlMissing();
    }

    callbacks.onStatus(input.key, "starting");
    callbacks.onLog(input.key, `Remote: ${remoteUrl}`);
    const restoreConsole = patchConsole(input.key, callbacks);
    callbacks.onLog(input.key, "Loading Module Federation runtime...");

    const baseUrl = remoteUrl
      .replace(/\/remoteEntry\.js$/, "")
      .replace(MANIFEST_DOCUMENT_PATTERN, "")
      .replace(/\/$/, "");
    // The host slot is pinned like every other remote (deriveVersionManifestFields
    // stamps `digest`), and the registered manifest document must come from the
    // pin's immutable coordinates — the fixed name at the mutable slot root is
    // the generation-skew tier (#874: a root publish moved bytes the child's
    // pin never named, and the boot composed them anyway).
    const slotRootManifestUrl = `${baseUrl}/mf-manifest.json`;
    const hostPin = runtimeConfig.host.digest;
    const imageManifest = readInImagePlatformManifest();
    let manifestUrl = slotRootManifestUrl;
    if (hostPin) {
      const resolvedPin = yield* Effect.tryPromise({
        try: () => resolveRemoteVersion({ base: remoteUrl, digest: hostPin }),
        catch: (cause) =>
          new OrchestratorError({
            operation: "resolve host pin",
            detail: `${hostPin.manifest} at ${remoteUrl} — ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            cause,
          }),
      }).pipe(
        Effect.retry({ schedule: BOOT_RETRY_SCHEDULE, while: isTransientBootFailure }),
        // Development keeps the unpinned fallback: an unresolved pin degrades
        // to the fixed name exactly as deriveVersionManifestFields tolerates
        // there; published configs fail loud (the pin is the boot contract).
        // The retry runs first, so dev retries a transient blip before it
        // degrades to the unpinned fallback.
        Effect.catchTag("OrchestratorError", (error) =>
          runtimeConfig.env === "development"
            ? Effect.logWarning(
                `[host pin] ${hostPin.manifest} failed to resolve, continuing unpinned (development): ${error.detail}`,
              ).pipe(Effect.as(null))
            : Effect.fail(error),
        ),
      );
      if (resolvedPin) {
        manifestUrl = pinnedManifestDocumentUrl(slotRootManifestUrl, resolvedPin);
        callbacks.onLog(input.key, `Host pin ${hostPin.manifest} → ${manifestUrl}`);
      }
    }

    // KEEP: the manifest IS the entry contract (ADR 0020 amendment: hashed
    // entrypoints, fixed-name `remoteEntry.js` retired — it 404s on the CDN).
    // A failed manifest fetch must fail loud with the URL and status: the old
    // silent fallback to remoteEntry.js turned any transient hiccup (a CDN
    // 403 challenge, a timeout) into a guaranteed loadRemote failure with no
    // named cause. Transient socket failures retry first — the 2026-11-20
    // rc.46 train lost its smoke gate to one instant `fetch failed` blip that
    // a second attempt would have absorbed.
    const entryUrl = yield* fetchWithRetryEff(manifestUrl, {
      timeout: MANIFEST_FETCH_DEADLINE,
      retries: BOOT_FETCH_RETRIES,
    }).pipe(
      Effect.filterOrFail(
        (res) => res.ok,
        (res) =>
          new OrchestratorError({
            operation: "fetch host manifest",
            detail: `${manifestUrl} — HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
          }),
      ),
      Effect.flatMap((res) =>
        Effect.tryPromise({
          try: () => res.json() as Promise<Record<string, unknown>>,
          catch: (cause) =>
            new OrchestratorError({
              operation: "fetch host manifest",
              detail: `${manifestUrl} — ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        }),
      ),
      Effect.filterOrFail(
        (json) =>
          !!json &&
          typeof json === "object" &&
          "metaData" in json &&
          "exposes" in json &&
          "shared" in json,
        () =>
          new OrchestratorError({
            operation: "fetch host manifest",
            detail: `${manifestUrl} — not a Module Federation manifest (missing metaData/exposes/shared)`,
          }),
      ),
      Effect.map(() => manifestUrl),
      Effect.mapError((cause) =>
        cause instanceof OrchestratorError
          ? cause
          : new OrchestratorError({
              operation: "fetch host manifest",
              detail: `${manifestUrl} — ${
                cause instanceof Error && cause.message ? cause.message : String(cause)
              }`,
              cause,
            }),
      ),
    );

    yield* Effect.promise(() => registerRemote({ name: "host", entry: entryUrl }));
    callbacks.onLog(input.key, `Loading host from ${entryUrl}...`);

    const hostModule = yield* Effect.tryPromise({
      try: () =>
        loadRemoteModule<{
          runServer: (input: ServerInput) => ServerHandle;
        }>("host/Server"),
      catch: (cause) =>
        new OrchestratorError({
          operation: "load host module",
          detail:
            `${cause instanceof Error ? cause.message : String(cause)}` +
            hostSkewRemediation(cause, imageManifest, runtimeConfig.host.digest, remoteUrl),
          cause,
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: LOAD_REMOTE_DEADLINE,
        orElse: () =>
          Effect.fail(
            new OrchestratorError({
              operation: "load host module",
              detail: `timed out after ${LOAD_REMOTE_DEADLINE} — the module (or its shared dependencies) did not finish loading from ${entryUrl}`,
            }),
          ),
      }),
      Effect.retry({ schedule: BOOT_RETRY_SCHEDULE, while: isTransientBootFailure }),
    );

    if (!hostModule?.runServer) {
      return yield* new HostModuleInvalid();
    }

    callbacks.onLog(input.key, "Starting server...");
    const hostPort = runtimeConfig.host?.port;
    const hostEnv: Record<string, string> | undefined = hostPort
      ? { PORT: String(hostPort) }
      : undefined;
    // The serving build's identity (#537): the host remote cannot read the
    // in-image platform manifest itself (its import.meta.url is a CDN URL),
    // so the booting process resolves it once and injects it.
    const platform = imageManifest
      ? {
          frameworkVersion: imageManifest.frameworkVersion,
          everyPluginVersion: imageManifest.everyPluginVersion,
          gitSha: imageManifest.gitSha,
          image: imageManifest.image,
        }
      : undefined;
    const serverHandle = hostModule.runServer({
      config: runtimeConfig,
      port: hostPort,
      env: hostEnv,
      platform,
    });
    yield* Effect.tryPromise({
      try: () => serverHandle.ready,
      catch: (cause) =>
        new OrchestratorError({
          operation: "start server",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: SERVER_READY_DEADLINE,
        // A half-started server must not leak its port on the deadline path —
        // the success path hands shutdown to the process handle instead.
        orElse: () =>
          Effect.gen(function* () {
            yield* Effect.exit(Effect.promise(() => serverHandle.shutdown()));
            return yield* new OrchestratorError({
              operation: "start server",
              detail: `server did not become ready within ${SERVER_READY_DEADLINE}`,
            });
          }),
      }),
    );

    return {
      name: input.key,
      pid: undefined,
      events: Stream.empty,
      terminate: () =>
        Effect.gen(function* () {
          callbacks.onLog(input.key, "Shutting down remote host...");
          restoreConsole();
          yield* Effect.tryPromise({
            try: () => serverHandle.shutdown(),
            catch: () => {},
          }).pipe(Effect.ignore);
        }),
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

export const spawnDevProcess = (input: {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly port: number;
  readonly generatedEnv: Record<string, string>;
  readonly shellTier: Record<string, string>;
  readonly runtimeConfigEnv: string;
}) =>
  Effect.gen(function* () {
    const fullCwd = input.cwd;
    const command = input.command;
    const args = input.args;
    const port = input.port;
    const name = input.name;

    // The descriptor's env joins the generated tier — folding it in before
    // composeSpawnEnv keeps the documented precedence (shell > generated >
    // .env-file); assigning after would let it outrank the shell tier (and
    // the generated-owned keys) silently.
    const envVars = composeSpawnEnv(
      process.env as Record<string, string>,
      { ...input.generatedEnv, ...input.env },
      port,
      input.shellTier,
    );

    envVars.BOS_RUNTIME_CONFIG = input.runtimeConfigEnv;

    const logQueue = yield* Queue.unbounded<UnitEvent>();
    let exited = false;
    let resolveExit: (() => void) | undefined;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const cmd = spawn(command, args, {
      cwd: fullCwd,
      env: envVars,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = cmd.pid ?? undefined;

    const offer = (event: UnitEvent) => {
      void Effect.runPromise(Queue.offer(logQueue, event).pipe(Effect.ignore));
    };

    const markExited = (code: number, signal?: string) => {
      if (exited) return;
      exited = true;
      offer({ type: "exited", code, signal: signal ?? undefined });
      resolveExit?.();
    };

    cmd.once("exit", (code, signal) => markExited(code ?? (signal ? 1 : 0), signal ?? undefined));
    cmd.once("error", (err) => {
      offer({ type: "log", line: `Spawn failed: ${err.message}`, stderr: true });
      markExited(1);
    });

    const handleLine = (line: string, isStderr: boolean) => {
      if (!line.trim()) return;
      const looksLikeError =
        isStderr &&
        /^(error|fail|fatal|exception|unhandled|reject)/i.test(stripAnsi(line)) &&
        !line.startsWith("$");
      offer({ type: "log", line, stderr: looksLikeError });
    };

    const wire = (source: Readable | null, isStderr: boolean) => {
      if (!source) return;
      const webStream = Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>;
      void Effect.runFork(
        Stream.runForEach((line: string) => Effect.sync(() => handleLine(line, isStderr)))(
          Stream.splitLines(
            Stream.decodeText(
              Stream.fromReadableStream({
                evaluate: () => webStream,
                onError: (cause) =>
                  new OrchestratorError({
                    operation: "read process output",
                    detail: String(cause),
                    cause,
                  }),
              }),
            ),
          ),
        ),
      );
    };
    wire(cmd.stdout, false);
    wire(cmd.stderr, true);

    const terminate = (mode: "graceful" | "force") =>
      Effect.gen(function* () {
        const groupSignal = (signal: NodeJS.Signals) =>
          Effect.try(() => {
            if (pid !== undefined) process.kill(-pid, signal);
          }).pipe(Effect.ignore);
        if (mode === "force") {
          yield* groupSignal("SIGKILL");
          yield* Effect.sleep("250 millis");
          return;
        }
        yield* groupSignal("SIGTERM");
        yield* Effect.promise(() =>
          Promise.race([exitPromise, new Promise((r) => setTimeout(r, 3000))]),
        );
        if (!exited) {
          yield* groupSignal("SIGKILL");
          yield* Effect.sleep("250 millis");
        }
      }).pipe(Effect.ignore);

    return {
      name,
      pid,
      events: Stream.fromQueue(logQueue),
      terminate,
    } satisfies ProcessHandle;
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
