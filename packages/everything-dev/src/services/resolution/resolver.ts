import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Cause,
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
import { bundleCachePath, readBundleCache, writeBundleCache } from "../../bundle-cache";
import { isAppDescriptorPath } from "../../config";
import { FetchNetworkError, HttpFetch, type HttpFetchShape } from "../../http-client";

type FetchImpl = typeof globalThis.fetch;

/**
 * Bundle resolution — the one seam every boot-time byte crosses (config
 * manifest discovery, contract-type fetches, federation remote loading, SSR
 * serving). Two tiers, one policy (ADR 0011/0021):
 *
 * - Self-contained runtime image: a staged namespace under `BOS_BUNDLE_DIR`
 *   resolves from disk; a miss falls through to the network so a partially-
 *   staged namespace boots over the wire instead of failing.
 * - Registry tier: plain resilient network fetch — CDN is the single
 *   distribution source. The stale-if-error disk cache exists only behind an
 *   explicit `BOS_BUNDLE_CACHE_DIR` opt-in; cached bytes are a resilience
 *   artifact, never a deployment, so a post-reset boot can never satisfy
 *   itself with pre-reset bytes.
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
  ".eot": "application/vnd.ms-opentype",
  ".wasm": "application/wasm",
  ".txt": "text/xml",
  ".xml": "application/xml",
};

/**
 * Maps a bundle URL onto the staged namespace layout. Bundle URLs carry their
 * namespace in the path (`…/bundles/<account>/<gateway>/<workspace>/…`); the
 * staged layout mirrors it under `<bundleDir>/<account>/<gateway>/…`. The
 * namespace is taken from the URL itself — this answers "which staged
 * directory do these bytes live in?" rather than "is this my namespace?" —
 * and the result is contained within the account/gateway directory. Returns
 * null for foreign shapes.
 */
export function bundleUrlToStagedPath(url: string, bundleDir: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "bundles" || segments.length < 3) return null;

  let decoded: string[];
  try {
    decoded = segments.slice(1).map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const [account, gateway, ...rest] = decoded;
  if (!account || !gateway || rest.length === 0) return null;

  const nsDir = path.resolve(bundleDir, account, gateway);
  const filePath = path.resolve(nsDir, ...rest);
  if (filePath === nsDir || !filePath.startsWith(nsDir + path.sep)) return null;
  return filePath;
}

/** Resolve a relative config-supplied path inside `dir`, or null on escape. */
export function resolveContained(dir: string, relative: string): string | null {
  const resolved = path.resolve(dir, ...relative.split("/").filter(Boolean));
  if (resolved === dir || !resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

/**
 * Own-namespace path for a bundle URL: the shared URL→staged-path mapping,
 * narrowed to the runtime identity — a URL whose encoded namespace differs
 * from `namespace.account`/`namespace.gateway` must fall to the network,
 * never serve a sibling namespace's staged bytes.
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
>()("everything-dev/resolver/BundleResolver") {
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
   * Explicit opt-in stale-if-error cache (child tier): `/bundles/…` URLs
   * write through to disk on success and serve last-known-good bytes when
   * the origin fails. Never derived implicitly — a cache that activates
   * itself can serve pre-reset bytes after a deploy.
   */
  cacheDir?: string;
  /** Per-attempt deadline for idempotent GETs crossing the interceptor. */
  timeoutMs?: number;
}

const staleResponse = (bytes: Uint8Array, url: string): Response => {
  const name = url.split("?")[0]?.split("/").pop() ?? "";
  const contentType = MIME_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
  return new Response(bytes.slice().buffer, {
    status: 200,
    headers: { "content-type": contentType, "x-bundle-cache": "stale" },
  });
};

const DEFAULT_ATTEMPT_TIMEOUT = "30 seconds";
const RETRY_BASE_DELAY = "250 millis";
const RETRY_CAP = "5 seconds";
const RETRY_TIMES = 4;

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

/**
 * One network attempt through the `HttpFetch` policy: the fetch runs under
 * the fiber's interruption signal, and `Effect.timeout` interrupts at the
 * deadline — aborting the in-flight request. The response is returned
 * regardless of status; transient statuses are lifted by the caller.
 */
const fetchAttempt = Effect.fn("resolver.attempt")(function* (
  http: HttpFetchShape,
  input: Parameters<FetchImpl>[0],
  init: Parameters<FetchImpl>[1],
  timeout: Duration.Duration,
): Effect.fn.Return<Response, FetchNetworkError | Cause.TimeoutError | TransientBundleResponse> {
  return yield* http.attempt(input, init).pipe(
    Effect.timeoutOrElse({
      duration: Duration.toMillis(timeout),
      orElse: () => Effect.fail(new Cause.TimeoutError()),
    }),
    Effect.filterOrFail(
      (response) => !isTransientStatus(response.status),
      (response) => new TransientBundleResponse({ response }),
    ),
  );
});

/**
 * The resilience policy for idempotent GETs crossing the interceptor
 * (ADR 0021 amendment — the CDN-only image): a cold boot has no staged
 * fallback, so one edge hiccup or a hung connection during the load window
 * must not hard-fail the host or a plugin. Transient statuses and network
 * errors (including the deadline's TimeoutError) retry on a capped
 * exponential schedule before propagating; the last transient response is
 * returned so an explicit stale-if-error cache still sees it. Non-GETs pass
 * through untouched; a caller-initiated cancellation is never spent on the
 * schedule.
 */
const resilientFetch = Effect.fn("resolver.fetch")(function* (
  http: HttpFetchShape,
  input: Parameters<FetchImpl>[0],
  init: Parameters<FetchImpl>[1],
  timeout: Duration.Duration,
): Effect.fn.Return<Response, Cause.TimeoutError | Error> {
  if (requestMethod(input, init) !== "GET") {
    return yield* http.attempt(input, init).pipe(Effect.mapError((cause) => asError(cause.cause)));
  }
  return yield* fetchAttempt(http, input, init, timeout).pipe(
    Effect.retry({
      schedule: Schedule.exponential(RETRY_BASE_DELAY).pipe(
        Schedule.upTo({ duration: RETRY_CAP, times: RETRY_TIMES }),
      ),
      // A caller-initiated cancellation is not transient — propagate it
      // immediately instead of spending the schedule on a canceled request.
      while: (error) =>
        !(
          (error instanceof FetchNetworkError || error instanceof Cause.TimeoutError) &&
          init?.signal?.aborted
        ),
    }),
    Effect.catchTags({
      TransientBundleResponse: (error) => Effect.succeed(error.response),
      FetchNetworkError: (error) => Effect.fail(asError(error.cause)),
    }),
  );
});

/**
 * Installs the resolver as a global fetch interceptor — the one seam every
 * boot-time consumer shares (config manifest discovery, contract-type
 * fetches, orchestrator host loading, MF remoteEntry/identity probes) and
 * the SSR serving path. One layered resolution policy, as a single Effect
 * program on the managed runtime: staged disk → network → (explicitly
 * opted-in) stale-if-error. Own-namespace URLs resolve from the staged
 * directory and fall through to the network on a miss; a miss never touches
 * the write-through cache — for the own namespace the staged disk IS the
 * resilience artifact. Inert when neither a staged namespace nor an
 * explicit cache is configured.
 */
export function installGlobalBundleFetch(options: BundleFetchOptions): BundleFetchHandle {
  const namespace = options.namespace;
  const cacheDir = options.cacheDir;
  const timeout = Duration.millis(options.timeoutMs ?? Duration.toMillis(DEFAULT_ATTEMPT_TIMEOUT));
  const original: FetchImpl = globalThis.fetch;

  const runtime = ManagedRuntime.make(
    Layer.mergeAll(BundleResolver.layer(namespace), HttpFetch.layerWith({ fetchImpl: original })),
  );

  const program = Effect.fn("resolver.program")(function* (
    input: Parameters<FetchImpl>[0],
    init?: Parameters<FetchImpl>[1],
  ): Effect.fn.Return<Response, Cause.TimeoutError | Error, BundleResolver | HttpFetch> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const http = yield* HttpFetch;

    if (namespace && bundleUrlToLocalPath(url, namespace)) {
      const resolver = yield* BundleResolver;
      const local = yield* resolver.lookup(input);
      if (local !== null) return local;
      return yield* resilientFetch(http, input, init, timeout);
    }

    if (cacheDir !== undefined && bundleCachePath(url, { cacheDir })) {
      const cachedRead = Effect.tryPromise(() => readBundleCache(url, { cacheDir }));
      return yield* Effect.gen(function* () {
        const response = yield* resilientFetch(http, input, init, timeout);
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

    return yield* resilientFetch(http, input, init, timeout);
  });

  interface FetchWithPreconnect {
    (input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]): Promise<Response>;
    preconnect?: (...args: unknown[]) => unknown;
  }

  const patched = ((input: Parameters<FetchImpl>[0], init?: Parameters<FetchImpl>[1]) =>
    runtime.runPromise(program(input, init))) as FetchWithPreconnect;
  const originalPreconnect = (original as FetchWithPreconnect).preconnect;
  if (originalPreconnect) {
    patched.preconnect = originalPreconnect.bind(original);
  }
  globalThis.fetch = patched as unknown as FetchImpl;
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
 * A deployment env that accidentally carries an empty or quoted-empty
 * `BOS_BUNDLE_DIR` (e.g. the literal two characters `""` from a quoting
 * mistake) normalizes to unset — silently, no warning.
 */
const normalizeBundleDir = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const unquoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  return unquoted.length > 0 ? unquoted : undefined;
};

/**
 * Boot-time installer for the CLI and the host server: derives the own
 * namespace from `BOS_BUNDLE_DIR` plus the runtime identity
 * (`BOS_ACCOUNT`/`BOS_GATEWAY` registry env taking precedence over the
 * bos.config.json fields), and the stale-if-error cache from an explicit
 * `BOS_BUNDLE_CACHE_DIR` — never implicit. Tier auto-detection (ADR 0021):
 * an identity whose namespace is not actually staged under the bundle dir
 * drops to the registry tier — plain resilient network fetch — instead of
 * deterministically 404ing own-namespace URLs against a foreign image's
 * staged bytes. Never throws — a missing or malformed identity leaves the
 * default fetch in place.
 */
export function installBundleFetchFromEnv(input: {
  configPath?: string | null;
}): BundleFetchHandle | null {
  const bundleDir = normalizeBundleDir(process.env.BOS_BUNDLE_DIR);
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
        `[bundles] staged namespace ${account}/${gateway} not found under ${JSON.stringify(bundleDir)} — registry tier (network fetch)`,
      );
    }
  }
  return installGlobalBundleFetch({ namespace, cacheDir });
}
