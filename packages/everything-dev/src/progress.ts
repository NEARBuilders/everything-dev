import { EventEmitter } from "node:events";
import { Clock, Effect, Exit } from "effect";
import type { PhaseTiming } from "./contract";

export type ProgressEvent = {
  phase: string;
  status: "running" | "done" | "error";
  durationMs?: number;
};

export const pluginEvents = new EventEmitter();

const emitProgress = (event: ProgressEvent) =>
  Effect.sync(() => {
    pluginEvents.emit("progress", event);
  });

export const timedPhase = Effect.fn("timedPhase")(function* <A, E, R>(
  timings: PhaseTiming[],
  name: string,
  effect: Effect.Effect<A, E, R>,
) {
  yield* emitProgress({ phase: name, status: "running" });
  const startedAt = yield* Clock.currentTimeMillis;
  const exit = yield* Effect.exit(effect);
  const durationMs = (yield* Clock.currentTimeMillis) - startedAt;
  if (Exit.isSuccess(exit)) {
    timings.push({ name, durationMs });
    yield* emitProgress({ phase: name, status: "done", durationMs });
    return exit.value;
  }
  yield* emitProgress({ phase: name, status: "error", durationMs });
  return yield* Effect.failCause(exit.cause);
});

export function timePhase<T>(
  timings: PhaseTiming[],
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return Effect.runPromise(timedPhase(timings, name, Effect.promise(fn)));
}
