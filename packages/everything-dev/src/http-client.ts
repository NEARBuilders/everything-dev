import { Data, Duration, Effect, Schedule } from "effect";

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

// --- Helpers ---

const isRetryable = (error: FetchError): boolean => {
  if (error instanceof FetchNetworkError) return true;
  if (error instanceof FetchTimeoutError) return true;
  if (error instanceof FetchHttpError) return error.status >= 500;
  return false;
};

// --- Low-level: just timeout + error classification, returns Response regardless of HTTP status ---

const fetchRawEff = (
  url: string,
  options?: FetchOptions,
): Effect.Effect<Response, FetchNetworkError | FetchTimeoutError> =>
  Effect.tryPromise({
    try: async () => {
      const timeoutMs = Duration.toMillis(options?.timeout ?? DEFAULT_TIMEOUT);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {
          method: options?.method ?? "GET",
          headers: options?.headers,
          body: options?.body,
          redirect: options?.redirect,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new FetchTimeoutError({ url });
        }
        throw new FetchNetworkError({ url, cause: error });
      } finally {
        clearTimeout(timer);
      }
    },
    catch: (error) => {
      if (error instanceof FetchNetworkError || error instanceof FetchTimeoutError) {
        return error;
      }
      return new FetchNetworkError({ url, cause: error });
    },
  });

// --- Adds HTTP status checking: non-2xx becomes FetchHttpError ---

const fetchEff = (url: string, options?: FetchOptions): Effect.Effect<Response, FetchError> =>
  fetchRawEff(url, options).pipe(
    Effect.flatMap((response) => {
      if (response.ok) return Effect.succeed(response);
      return Effect.fail(
        new FetchHttpError({ url, status: response.status, statusText: response.statusText }),
      );
    }),
  );

// --- With retry ---

const retrySchedule = Schedule.exponential(EXPONENTIAL_BASE).pipe(
  Schedule.upTo({ duration: EXPONENTIAL_CAP, times: DEFAULT_RETRIES }),
);

export const fetchWithRetryEff = (
  url: string,
  options?: FetchWithRetryOptions,
): Effect.Effect<Response, FetchError> => {
  const retries = options?.retries ?? DEFAULT_RETRIES;

  if (retries <= 0) return fetchEff(url, options);

  const schedule =
    options?.retries !== undefined
      ? Schedule.exponential(EXPONENTIAL_BASE).pipe(
          Schedule.upTo({ duration: EXPONENTIAL_CAP, times: retries }),
        )
      : retrySchedule;

  return fetchEff(url, options).pipe(
    Effect.retry({
      schedule,
      while: isRetryable,
    }),
  );
};

// --- In-memory GET cache (per-process, prevents duplicate round trips) ---

const getCache = new Map<string, { data: unknown; expiresAt: number }>();
const GET_CACHE_TTL_MS = 30_000;

function isCacheable(_url: string, options?: FetchWithRetryOptions): boolean {
  if (options?.method && options.method !== "GET") return false;
  if (options?.body) return false;
  return true;
}

// --- Promise wrappers (bridge for non-Effect code) ---

export const fetchResponse = (url: string, options?: FetchOptions): Promise<Response> =>
  Effect.runPromise(fetchRawEff(url, options));

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

  const retries = options?.retries ?? DEFAULT_RETRIES;
  const eff =
    retries > 0 ? fetchWithRetryEff(url, { ...options, retries }) : fetchEff(url, options);

  try {
    const res = await Effect.runPromise(eff);
    const data = (await res.json()) as T;
    if (isCacheable(url, options)) {
      getCache.set(url, { data, expiresAt: Date.now() + GET_CACHE_TTL_MS });
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
