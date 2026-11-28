import { Effect, Schedule } from "effect";
import { fetchWithRetryEff } from "../../utils/http-client";

const tryUrl = (url: string, method?: "GET" | "POST"): Effect.Effect<boolean> =>
  fetchWithRetryEff(url, { timeout: "2 seconds", retries: 0, ...(method ? { method } : {}) }).pipe(
    Effect.map((response) => response.ok),
    Effect.orElseSucceed(() => false),
  );

/** One readiness tick: try each probe URL in order; first 200 wins. */
export const probeOk = (urls: readonly string[], method?: "GET" | "POST"): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    for (const url of urls) {
      if (yield* tryUrl(url, method)) return true;
    }
    return false;
  });

/** Local units get a fixed fast tick; remote probes get capped exponential
 * backoff (a remote that isn't up shouldn't be hammered every 200ms). */
export const localReadinessSchedule = Schedule.spaced("200 millis");

export const remoteReadinessSchedule = Schedule.min([
  Schedule.exponential("1 seconds", 1.5),
  Schedule.spaced("15 seconds"),
]);
