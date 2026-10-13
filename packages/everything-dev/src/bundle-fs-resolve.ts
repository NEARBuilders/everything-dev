import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type Cause,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  ManagedRuntime,
  Schedule,
  Schema,
} from "effect";
import { cacheControlOf } from "every-plugin/build/artifact-names";
import {
  bundleCachePath,
  bundleCacheRoot,
  readBundleCache,
  writeBundleCache,
} from "./bundle-cache";
import { bundleUrlToStagedPath } from "./bundle-path";
import { isAppDescriptorPath } from "./config";

/**
 * Local-first bundle resolution (ADR 0011 amendment; unified policy, ADR 0021
 * amendment): a self-contained runtime image stages its own namespace under
 * `BOS_BUNDLE_DIR` as `bundles/<account>/<gateway>/<workspace>/…` and consumes
 * those bytes directly from disk; a miss falls through to the network, so a
 * partially-staged namespace boots over the wire instead of failing. The
 * registry tier (children, `BOS_BUNDLE_DIR` unset) keeps the network fetch —
 * the namespace guard below only ever matches the runtime's own
 * account/gateway, never another runtime's layout.
 */

export interface BundleNamespace {
  readonly bundleDir: string;
  readonly account: string;
  readonly gateway: string;
}

export class BundleReadError extends Schema.TaggedError<BundleReadError>()("BundleReadError", {
  path: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const MIME_TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".html": "text/html",
  ".htm": "text/html",
  ".webmanifest": "application/manifest+json",
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

/**
 * Own-namespace path for a bundle URL: the shared URL→staged-path mapping,
 * narrowed to the runtime identity — a URL whose encoded namespace differs
 * from `namespace.account`/`namespace.gateway` must fall to the network/cache
 * path, never serve a sibling namespace's staged bytes.
 */
export function bundleUrlToLocalPath(url: string, namespace: BundleNamespace): string | null {
  const filePath = bundleUrlToStagedPath(url, namespace.bundleDir);
  if (!filePath) return null;

  const nsDir = path.resolve(namespace.bundleDir, namespace.account, namespace.gateway);
  if (filePath !== nsDir && !filePath.startsWith(nsDir + path.sep)) return null;

  return filePath;
}

export class BundleResolver extends Context.Service<
  BundleResolver,
  {
    /** Resolve a fetch target from the staged namespace; null = miss or not our namespace — fall through to the network. */
    readonly lookup: (input: string | URL | Request) => Effect.Effect<Response | null>;
  }
>()("everything-dev/bundle-fs-resolve/BundleResolver") {
  static layer(namespace: BundleNamespace | undefined): Layer.Layer<BundleResolver> {
    if (!namespace) {
      return Layer.succeed(
        BundleResolver,
        BundleResolver.of({ lookup: () => Effect.succeed(null) }),
      );
    }
    const respond = Effect.fn("BundleResolver.respond")(function* (
      url: string,
    ): Effect.fn.Return<Response | null, never> {
      const filePath = bundleUrlToLocalPath(url, namespace);
      if (!filePath) return null;
      const bytes = yield* Effect.tryPromise({
        try: () => readFile(filePath),
        catch: (cause) => new BundleReadError({ path: filePath, cause }),
      }).pipe(Effect.catchTag("BundleReadError", () => Effect.succeed(null)));
      if (bytes === null) return null;
      const name = path.basename(filePath);
      const contentType =
        MIME_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": contentType,
          "cache-control": cacheControlOf(name),
          etag: `"${Buffer.from(bytes.subarray(0, 4096)).toString("base64").slice(0, 24)}"`,
        },
      });
    });

    return Layer.effect(
      BundleResolver,
      Effect.succeed(
        BundleResolver.of({
          lookup: (input) => {
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            return respond(url);
          },
        }),
      ),
    );
  }
}

export interface BundleFetchHandle {
  readonly uninstall: () => Promise<void>;
}

export interface BundleFetchOptions {
  /** Own-namespace FS resolution — requires a staged `BOS_BUNDLE_DIR`. */
  namespace?: BundleNamespace;
  /**
   * Foreign-namespace stale-if-error cache (child tier): `/bundles/…` URLs
   * outside the own namespace write through to disk on success and serve
   * the last-known-good bytes when the origin fails. Enabled implicitly
   * when `namespace` is present (deployment contexts), or explicitly via
   * `BOS_BUNDLE_CACHE_DIR`.
   */
  cacheDir?: string;
  /** Per-attempt deadline for idempotent GETs crossing the interceptor. */
  timeoutMs?: number;
}

type FetchImpl = typeof globalThis.fetch;

const staleResponse = (bytes: Uint8Array, url: string): Response => {
  const name = url.split("?")[0].split("/").pop() ?? "";
  const contentType = MIME_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
  return new Response(bytes.slice().buffer, {
    status: 200,
    headers: { "content-type": contentType, "x-bundle-cache": "stale" },
  });
};

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_BASE_DELAY = "250 millis";
const RETRY_TIMES = 2;

const isTransientStatus = (status: number): boolean => status === 429 || status >= 500;

function requestMethod(input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "string" || input instanceof URL) return "GET";
  return input.method.toUpperCase();
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/** A 429/5xx response — carried as a failure so the Schedule can retry it,
 * with the Response kept for the exhausted-retries fallthrough. */
class TransientBundleResponse extends Data.TaggedError("TransientBundleResponse")<{
  readonly response: Response;
}> {}

class BundleFetchFailure extends Data.TaggedError("BundleFetchFailure")<{
  readonly cause: Error;
}> {}

/**
 * One network attempt: the fetch runs under the fiber's interruption signal
 * (Effect v4 hands `tryPromise` the signal; `Effect.timeout` interrupts at
 * the deadline, which aborts the in-flight request), composed with any
 * caller-provided signal so external cancellation still wins.
 */
const fetchAttempt = Effect.fn("bundleFetch.attempt")(function* (
  original: FetchImpl,
  input: Parameters<FetchImpl>[0],
  init: Parameters<FetchImpl>[1],
  timeout: Duration.Duration,
): Effect.fn.Return<Response, BundleFetchFailure | TransientBundleResponse | Cause.TimeoutError> {
  return yield* Effect.tryPromise({
    try: (signal) =>
      original(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      }),
    catch: (cause) => new BundleFetchFailure({ cause: asError(cause) }),
  }).pipe(
    Effect.filterOrFail(
      (response) => !isTransientStatus(response.status),
      (response) => new TransientBundleResponse({ response }),
    ),
    Effect.timeout(timeout),
  );
});

/**
 * The resilience policy for idempotent GETs crossing the interceptor
 * (ADR 0021 amendment — the CDN-only image): a cold boot has no staged
 * fallback, so one edge hiccup or a hung connection during the load window
 * must not hard-fail the host or a plugin. Transient statuses and network
 * errors (including the deadline's TimeoutError) retry on an exponential
 * schedule before propagating; the last transient response is returned so a
 * stale-if-error cache still sees it. Non-GETs pass through untouched.
 */
const resilientFetch = Effect.fn("bundleFetch")(function* (
  original: FetchImpl,
  input: Parameters<FetchImpl>[0],
  init: Parameters<FetchImpl>[1],
  timeout: Duration.Duration,
): Effect.fn.Return<
  Response,
  BundleFetchFailure | TransientBundleResponse | Cause.TimeoutError | Error
> {
  if (requestMethod(input, init) !== "GET") {
    return yield* Effect.tryPromise({
      try: () => original(input, init),
      catch: (cause) => new BundleFetchFailure({ cause: asError(cause) }),
    }).pipe(Effect.catchTag("BundleFetchFailure", (error) => Effect.fail(error.cause)));
  }
  return yield* fetchAttempt(original, input, init, timeout).pipe(
    Effect.retry({
      schedule: Schedule.exponential(RETRY_BASE_DELAY).pipe(Schedule.upTo({ times: RETRY_TIMES })),
      // A caller-initiated cancellation is not transient — propagate it
      // immediately instead of spending the schedule on a canceled request.
      while: (error) =>
        !(
          error instanceof BundleFetchFailure &&
          error.cause instanceof Error &&
          init?.signal?.aborted
        ),
    }),
    Effect.catchTags({
      TransientBundleResponse: (error) => Effect.succeed(error.response),
      BundleFetchFailure: (error) => Effect.fail(error.cause),
    }),
  );
});

/**
 * Installs the resolver as a global fetch interceptor — the one seam every
 * boot-time consumer shares (config manifest discovery, contract-type
 * fetches, orchestrator host loading, MF remoteEntry/identity probes) and
 * the SSR serving path. One layered resolution policy, as a single Effect
 * program on the managed runtime: staged disk → network → stale-if-error.
 * Own-namespace URLs resolve from the staged directory and fall through to
 * the network on a miss (a partially-staged namespace boots over the wire
 * instead of failing); a miss never touches the write-through cache — for
 * the own namespace the staged disk IS the resilience artifact. Foreign
 * `/bundles/…` URLs get the network with the stale-if-error cache; every
 * other URL falls through to the network. Inert when neither a staged
 * namespace nor a cache is configured.
 */
export function installGlobalBundleFetch(options: BundleFetchOptions): BundleFetchHandle {
  const namespace = options.namespace;
  const cacheDir = options.cacheDir;
  const timeout = Duration.millis(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const runtime = ManagedRuntime.make(BundleResolver.layer(namespace));
  const original: FetchImpl = globalThis.fetch;

  const program = Effect.fn("bundleFetch.program")(function* (
    input: Parameters<FetchImpl>[0],
    init?: Parameters<FetchImpl>[1],
  ): Effect.fn.Return<
    Response,
    BundleFetchFailure | TransientBundleResponse | Cause.TimeoutError | Error,
    BundleResolver
  > {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (namespace && bundleUrlToLocalPath(url, namespace)) {
      const resolver = yield* BundleResolver;
      const local = yield* resolver.lookup(input);
      if (local !== null) return local;
      return yield* resilientFetch(original, input, init, timeout);
    }

    if (cacheDir !== undefined && bundleCachePath(url, { cacheDir })) {
      const cachedRead = Effect.tryPromise(() => readBundleCache(url, { cacheDir }));
      return yield* Effect.gen(function* () {
        const response = yield* resilientFetch(original, input, init, timeout);
        if (response.ok) {
          // write-through is best-effort
          yield* Effect.tryPromise(async () => {
            const bytes = new Uint8Array(await response.clone().arrayBuffer());
            await writeBundleCache(url, bytes, { cacheDir });
          }).pipe(Effect.ignore);
        } else {
          const cached = yield* cachedRead;
          if (cached) return staleResponse(cached, url);
        }
        return response;
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const cached = yield* cachedRead;
            if (cached) return staleResponse(cached, url);
            return yield* Effect.fail(error);
          }),
        ),
      );
    }

    return yield* resilientFetch(original, input, init, timeout);
  });

  const patched = ((input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]) =>
    runtime.runPromise(program(input, init))) as FetchImpl;
  const originalPreconnect = (original as Partial<FetchImpl>).preconnect;
  if (originalPreconnect) {
    patched.preconnect = originalPreconnect.bind(original);
  }
  globalThis.fetch = patched;
  return {
    uninstall: async () => {
      if (globalThis.fetch === patched) {
        globalThis.fetch = original;
      }
      await runtime.dispose();
    },
  };
}

/**
 * Boot-time installer for the CLI: derives the own namespace from
 * `BOS_BUNDLE_DIR` plus the runtime identity (`BOS_ACCOUNT`/`BOS_GATEWAY`
 * registry env taking precedence over the bos.config.json fields), and the
 * foreign-namespace cache from `BOS_BUNDLE_CACHE_DIR`. Tier auto-detection
 * (ADR 0021): an identity whose namespace is not actually staged under the
 * bundle dir drops to the registry tier — plain network fetch — instead of
 * deterministically 404ing own-namespace URLs against a foreign image's
 * staged bytes. Never throws — a missing or malformed identity leaves the
 * default network fetch in place.
 */
export function installBundleFetchFromEnv(input: {
  configPath?: string | null;
}): BundleFetchHandle | null {
  const bundleDir = process.env.BOS_BUNDLE_DIR;
  const cacheDir = process.env.BOS_BUNDLE_CACHE_DIR;
  if (!bundleDir && cacheDir === undefined) return null;

  let configAccount: string | undefined;
  let configGateway: string | undefined;
  const configPath = input.configPath;
  if (configPath && !isAppDescriptorPath(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
        account?: string;
        domain?: string;
      };
      configAccount = parsed.account;
      configGateway = parsed.domain;
    } catch {
      // unreadable config — identity may still come from the registry env
    }
  }

  const account = process.env.BOS_ACCOUNT ?? configAccount;
  const gateway = process.env.BOS_GATEWAY ?? configGateway;
  if (bundleDir && (!account || !gateway)) return null;

  let namespace: BundleNamespace | undefined;
  if (bundleDir && account && gateway) {
    if (existsSync(path.join(bundleDir, account, gateway))) {
      namespace = { bundleDir, account, gateway };
    } else {
      console.warn(
        `[bundles] staged namespace ${account}/${gateway} not found under ${bundleDir} — registry tier (network fetch)`,
      );
    }
  }
  return installGlobalBundleFetch({
    namespace,
    cacheDir: cacheDir ?? (namespace ? bundleCacheRoot() : undefined),
  });
}
