import { Cause, Data, Effect, Exit, type Layer } from "effect";

class TestRunError extends Data.TaggedError("TestRunError")<{ cause: unknown }> {}

export interface ServiceHarness<Svc> {
  run<A>(
    layer: Layer.Layer<any, unknown, never>,
    fn: (svc: Svc) => Promise<A> | Effect.Effect<A, unknown, never>,
  ): Promise<A>;
  squashError<A>(
    layer: Layer.Layer<any, unknown, never>,
    fn: (svc: Svc) => Promise<A> | Effect.Effect<A, unknown, never>,
  ): Promise<unknown>;
}

export function createServiceHarness<Svc, Tags>(
  servicesOf: Effect.Effect<Svc, never, Tags>,
): ServiceHarness<Svc> {
  const compose = (
    layer: Layer.Layer<Tags, unknown, never>,
    fn: (svc: Svc) => Promise<unknown> | Effect.Effect<unknown, unknown, never>,
  ) =>
    Effect.gen(function* () {
      const svc = yield* servicesOf;
      return yield* Effect.suspend(() => {
        const result = fn(svc);
        return Effect.isEffect(result)
          ? result
          : Effect.tryPromise({
              try: () => result,
              catch: (error) => new TestRunError({ cause: error }),
            });
      });
    }).pipe(Effect.provide(layer));

  return {
    run: async <A>(
      layer: Layer.Layer<any, unknown, never>,
      fn: (svc: Svc) => Promise<A> | Effect.Effect<A, unknown, never>,
    ) => (await Effect.runPromise(compose(layer, fn))) as A,
    squashError: async (layer, fn) => {
      const exit = await Effect.runPromiseExit(compose(layer, fn));
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected effect to fail");
      }
      const squashed = Cause.squash(exit.cause);
      return squashed instanceof TestRunError ? squashed.cause : squashed;
    },
  };
}
