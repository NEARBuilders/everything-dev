/**
 * Remote-entry loading resilience — the ONE contract every MF consumer in
 * the dev stack shares (plugin dev serves, the host's plugin loader).
 *
 * Two failure classes it exists for:
 * 1. Cold compile: remoteEntry.js 404s until the remote's first build —
 *    the 404 body gets eval'd as JS ("Unexpected identifier 'Found'").
 * 2. Watch-rebuild poisoning: a failed entry load is memoized forever in
 *    `globalThis.__GLOBAL_LOADING_REMOTE_ENTRY__` (runtime-core never evicts
 *    rejections), so retries without a purge await the same failure.
 */
import { Duration, Effect, Schedule } from "effect";
import type { PluginRuntimeError } from "./runtime/errors";
import {
  classifyPluginFailure,
  deepestErrorStack,
  type PluginFailureClassification,
  toPluginRuntimeError,
} from "./runtime/errors";

const POLL_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 120_000;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deletes the failed remote's keys from the process-global entry-load cache.
 * Deleting a RESOLVED entry would force a wasteful re-eval, so only call
 * this from failure paths.
 */
export const purgeRemoteEntryCache = (remoteUrl: string): void => {
  const globalLoading = (globalThis as Record<string, unknown>).__GLOBAL_LOADING_REMOTE_ENTRY__ as
    | Record<string, unknown>
    | undefined;
  if (!globalLoading) return;
  for (const key of Object.keys(globalLoading)) {
    if (key.endsWith(`:${remoteUrl}`)) delete globalLoading[key];
  }
};

export const isRemoteEntryBody = (body: string): boolean =>
  !/not found|<(!doctype|html)/i.test(body.slice(0, 64));

export const waitForRemoteEntryReady = async (
  label: string,
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  while (Date.now() < deadline) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok && isRemoteEntryBody(await res.text().catch(() => ""))) return;
    if (!announced) {
      announced = true;
      console.log(`⏳ waiting for ${label} to compile (remote entry not ready)…`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${label} remote entry never became ready at ${url}`);
};

export interface PluginLoadAttemptInfo {
  attempt: number;
  classification: PluginFailureClassification;
}

export interface PluginLoadRetryOptions<T> {
  /** short plugin key for log prefixes (host entry key or plugin id) */
  label: string;
  remoteUrl: string;
  load: () => Promise<T>;
  /** wall-clock budget for the retry loop */
  timeoutMs?: number;
  /**
   * Budget for the readiness poll (cold-compile wait) — defaults to the
   * retry budget, preserving the historical behavior. Pass `0` to skip the
   * poll (useful when the caller stubs `load` and does not need network).
   */
  readinessTimeoutMs?: number;
  /**
   * Observes every failed attempt (including non-retryable ones that end the
   * loop). Defaults to classification-deduped console.error under the
   * `[Plugins]` prefix.
   */
  onAttempt?: ((error: unknown, info: PluginLoadAttemptInfo) => void) | undefined;
}

/**
 * The one plugin-load retry policy: poll the remote entry until it is actually
 * served, then load with capped exponential backoff — purging the poisoned
 * global entry cache between attempts so each retry genuinely re-fetches.
 *
 * Recovery policy is `classifyPluginFailure().retryable`: transient network
 * conditions retry until the wall-clock budget runs out; permanent failures
 * (MF identity skew, schema validation, dead remotes, TLS verification) fail
 * fast on the first attempt instead of burning the budget silently.
 *
 * Fails with the ORIGINAL error from `load` — the host builds
 * `PluginBootstrapError.cause` from it and classification walks it.
 */
export const loadRemoteWithRetry = <T>(
  options: PluginLoadRetryOptions<T>,
): Effect.Effect<T, PluginRuntimeError> => {
  const {
    label,
    remoteUrl,
    load,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    readinessTimeoutMs,
    onAttempt,
  } = options;
  const readinessTimeout = readinessTimeoutMs ?? timeoutMs;

  const schedule = Schedule.exponential(Duration.millis(RETRY_BASE_DELAY_MS)).pipe(
    Schedule.modifyDelay(({ output }) =>
      Effect.succeed(
        Duration.toMillis(output) > RETRY_MAX_DELAY_MS
          ? Duration.millis(RETRY_MAX_DELAY_MS)
          : output,
      ),
    ),
    Schedule.upTo({ duration: Duration.millis(timeoutMs) }),
  );

  let attempt = 0;
  let lastSignature: string | undefined;
  const reportFailure = (error: unknown): void => {
    attempt += 1;
    purgeRemoteEntryCache(remoteUrl);
    const classification = classifyPluginFailure(error);
    if (onAttempt) {
      onAttempt(error, { attempt, classification });
      return;
    }
    const signature = `${classification.kind}::${classification.message}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    // The message alone is rarely enough, and the wrapper's own stack points
    // at the wrapping frames — log the DEEPEST cause's stack (the original
    // throw site inside the evaluated remote entry).
    const stack = deepestErrorStack(error);
    console.error(
      `[Plugins][${label}] ❌ ${classification.kind} failure (attempt ${attempt}): ${classification.message}` +
        (classification.suggestion ? `\n[Plugins][${label}] → ${classification.suggestion}` : "") +
        (stack ? `\n[Plugins][${label}] ${stack}` : ""),
    );
  };

  const loadWithRetry = Effect.tryPromise({
    try: load,
    catch: (error) => toPluginRuntimeError(error, label, undefined, "remote-entry-load"),
  }).pipe(
    Effect.tapError((error) => Effect.sync(() => reportFailure(error))),
    Effect.retry({ schedule, while: (error) => classifyPluginFailure(error).retryable }),
  );

  // readinessTimeoutMs: 0 skips the cold-compile poll (tests stub `load` and
  // must not race a 1ms wall-clock window against the event loop).
  if (readinessTimeout === 0) {
    return loadWithRetry;
  }

  return Effect.tryPromise({
    try: () => waitForRemoteEntryReady(label, remoteUrl, readinessTimeout),
    catch: (error) => toPluginRuntimeError(error, label, undefined, "remote-entry-readiness"),
  }).pipe(Effect.flatMap(() => loadWithRetry));
};
