import { Data, Effect, Schedule, Stream } from "effect";
import { MANIFEST_DOCUMENT_PATTERN } from "every-plugin/ui/manifest/contract";
import type { RuntimeConfig } from "../../types";
import { fetchWithRetryEff } from "../../utils/http-client";
import { pinnedManifestDocumentUrl, resolveRemoteVersion } from "../deploy/version-manifest";
import { loadRemoteModule, registerRemote } from "../federation/service";
import { readInImagePlatformManifest } from "../platform/manifest";
import type { ProcessCallbacks, ProcessHandle } from "./units";
import { OrchestratorError } from "./units";

export { OrchestratorError };

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

/** The load-failure marker the shared-singleton resolver throws with — its
 * bare package error hides the drift story (#874), so the two plane
 * identities and the remediation ride the same failure detail. */
const SHARED_DEP_DRIFT_MARKER = "Could not resolve shared dependency";

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
