import process from "node:process";
import { Effect, References } from "effect";
import {
  type EffectLogLevel,
  type LogLevelEnv,
  resolveLogLevel,
  toEffectLogLevel,
} from "everything-dev/dev-log-pipeline";

/** The host process's Effect log ceiling, from the shared CLI log-level flags
 * (`BOS_LOG_LEVEL` / `DEBUG`) — no new env vars. `Effect.logDebug` marks in the
 * SSR seams are filtered out unless this resolves to "Debug". */
export const minimumLogLevel = (): EffectLogLevel =>
  toEffectLogLevel(resolveLogLevel(process.env as LogLevelEnv));

/** Run an Effect program with the host's log level wired, so debug marks and
 * Effect logging in the SSR seams surface under the same flags as the CLI. */
export function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.provideService(References.MinimumLogLevel, minimumLogLevel())),
  );
}

/** Fire-and-forget debug mark for synchronous (promise-land) seams — cache
 * hits and gate checks that never become an Effect. Level-gated the same way:
 * the Effect never runs (a microtask fiber) unless Debug logging is on. */
export function mark(message: string, fields: Record<string, unknown>): void {
  if (minimumLogLevel() !== "Debug") return;
  void Effect.runFork(Effect.logDebug(message).pipe(Effect.annotateLogs(fields)));
}
