import { Context, Data, Duration, Effect, Layer, Schedule } from "effect";

// --- Tagged errors ---

export class FetchNetworkError extends Data.TaggedError("FetchNetworkError")<{
  url: string;
  cause: unknown;
}> {}

export class FetchTimeoutError extends Data.TaggedError("FetchTimeoutError")<{
  url: string;
}> {}

export class FetchHttpError extends Data.TaggedError("FetchHttpError")<{
  url: string;
  status: number;
  statusText: string;
}> {}

export type FetchError = FetchNetworkError | FetchTimeoutError | FetchHttpError;

// --- Options ---

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  redirect?: RequestRedirect;
  timeout?: Duration.Input;
}

export interface FetchWithRetryOptions extends FetchOptions {
  retries?: number;
}

// --- Defaults ---

const DEFAULT_TIMEOUT = "10 seconds";
const DEFAULT_RETRIES = 3;

const EXPONENTIAL_BASE = Duration.seconds(1);
const EXPONENTIAL_CAP = Duration.seconds(15);

type FetchImpl = typeof globalThis.fetch;

// --- Helpers ---

const isRetryable = (error: FetchError): boolean => {
  if (error instanceof FetchNetworkError) return true;
  if (error instanceof FetchTimeoutError) return true;
  if (error instanceof FetchHttpError) return error.status >= 500;
  return false;
};

export interface HttpFetchShape {
  /** One network attempt: no status assertion, no internal deadline. The
   * fiber's signal is composed with any caller-provided signal, so an
   * `Effect.timeout` around the call aborts the in-flight request, and a
   * caller-initiated cancellation still wins. */
  readonly attempt: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Effect.Effect<Response, FetchNetworkError>;
  /** attempt + deadline + ok assertion (non-2xx → `FetchHttpError`) + capped
   * exponential jittered retry (5xx/network/timeout retried, 4xx not). */
  readonly get: (
    url: string,
    options?: FetchWithRetryOptions,
  ) => Effect.Effect<Response, FetchError>;
}

const makeHttpFetch = (
  base: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): HttpFetchShape => {
  const urlOf = (input: string | URL | Request): string =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  const attempt = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Effect.Effect<Response, FetchNetworkError> =>
    Effect.tryPromise({
      try: (signal) =>
        base(input, {
          ...init,
          signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
        }),
      catch: (cause) => new FetchNetworkError({ url: urlOf(input), cause }),
    });

  const get = (
    url: string,
    options?: FetchWithRetryOptions,
  ): Effect.Effect<Response, FetchError> => {
    const timeoutMs = Duration.toMillis(options?.timeout ?? DEFAULT_TIMEOUT);
    const retries = options?.retries ?? DEFAULT_RETRIES;
    const once = attempt(url, {
      method: options?.method ?? "GET",
      headers: options?.headers,
      body: options?.body,
      redirect: options?.redirect,
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.fail(new FetchTimeoutError({ url })),
      }),
      Effect.filterOrFail(
        (response) => response.ok,
        (response) =>
          new FetchHttpError({ url, status: response.status, statusText: response.statusText }),
      ),
    );
    if (retries <= 0) return once;
    return once.pipe(
      Effect.retry({
        schedule: Schedule.exponential(EXPONENTIAL_BASE).pipe(
          Schedule.upTo({ duration: EXPONENTIAL_CAP, times: retries }),
          Schedule.jittered,
        ),
        while: isRetryable,
      }),
    );
  };

  return { attempt, get };
};

const defaultHttpFetch = makeHttpFetch((url, init) => globalThis.fetch(url, init));

/**
 * The HTTP seam for boot-path consumers (bundle resolution, federation
 * loading, orchestrator deadlines): one resilience policy — interruption-
 * backed deadlines, capped exponential jittered retry, typed errors — with
 * the base fetch injectable so the bundle fetch interceptor can point it at
 * the pre-patch `fetch` and not re-enter itself.
 */
export class HttpFetch extends Context.Service<HttpFetch, HttpFetchShape>()(
  "everything-dev/http-client/HttpFetch",
) {
  static layerWith(options: { fetchImpl: FetchImpl }): Layer.Layer<HttpFetch> {
    return Layer.succeed(HttpFetch, makeHttpFetch(options.fetchImpl));
  }

  static readonly layer: Layer.Layer<HttpFetch> = Layer.succeed(HttpFetch, defaultHttpFetch);
}

// --- In-memory GET cache (per-process, prevents duplicate round trips) ---

const getCache = new Map<string, { data: unknown; expiresAt: number }>();
const GET_CACHE_TTL_MS = 30_000;
const GET_CACHE_MAX_ENTRIES = 128;

export function clearHttpCache(): void {
  getCache.clear();
}

export function httpCacheSize(): number {
  return getCache.size;
}

function setCached(url: string, data: unknown): void {
  const now = Date.now();
  for (const [key, entry] of getCache) {
    if (entry.expiresAt <= now) getCache.delete(key);
  }
  if (getCache.size >= GET_CACHE_MAX_ENTRIES) {
    for (const key of getCache.keys()) {
      getCache.delete(key);
      if (getCache.size < GET_CACHE_MAX_ENTRIES) break;
    }
  }
  getCache.set(url, { data, expiresAt: now + GET_CACHE_TTL_MS });
}

function isCacheable(_url: string, options?: FetchWithRetryOptions): boolean {
  if (options?.method && options.method !== "GET") return false;
  if (options?.body) return false;
  return true;
}

// --- Promise wrappers (bridge for non-Effect code) — the ambient call-time
// lookup means a boot fetch crossing the bundle interceptor still gains its
// retry/deadline policy; the fiber-signal composition aborts the in-flight
// request at the deadline. ---

/** One raw fetch attempt with a deadline: returns the Response regardless of
 * status; rejects on network failure or deadline expiry. */
export const fetchRaw = (
  url: string,
  init?: RequestInit,
  timeout: Duration.Input = DEFAULT_TIMEOUT,
): Promise<Response> =>
  Effect.runPromise(
    defaultHttpFetch.attempt(url, init).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new FetchTimeoutError({ url })),
      }),
    ),
  );

export const fetchResponse = (url: string, options?: FetchOptions): Promise<Response> =>
  Effect.runPromise(
    defaultHttpFetch
      .attempt(url, {
        method: options?.method,
        headers: options?.headers,
        body: options?.body,
        redirect: options?.redirect,
      })
      .pipe(
        Effect.timeoutOrElse({
          duration: options?.timeout ?? DEFAULT_TIMEOUT,
          orElse: () => Effect.fail(new FetchTimeoutError({ url })),
        }),
      ),
  );

export const fetchJsonOrNull = async <T>(
  url: string,
  options?: FetchWithRetryOptions,
): Promise<T | null> => {
  if (isCacheable(url, options)) {
    const cached = getCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }
  }

  try {
    const res = await Effect.runPromise(defaultHttpFetch.get(url, options));
    const data = (await res.json()) as T;
    if (isCacheable(url, options)) {
      setCached(url, data);
    }
    return data;
  } catch (error) {
    const msg =
      error instanceof FetchNetworkError
        ? `[http] Network error: ${error.url} — ${String(error.cause)}`
        : error instanceof FetchTimeoutError
          ? `[http] Timeout: ${error.url}`
          : error instanceof FetchHttpError
            ? `[http] HTTP ${error.status}: ${error.url}`
            : `[http] Unknown error while fetching ${url}`;
    console.error(msg);
    return null;
  }
};

export const fetchWithRetryEff = (
  url: string,
  options?: FetchWithRetryOptions,
): Effect.Effect<Response, FetchError> => defaultHttpFetch.get(url, options);
