import { Context, Data, Effect, Layer } from "effect";
import { type PidEntry, pruneDeadEffect, readRegistry } from "./registry";

export class ProcessesRegistryError extends Data.TaggedError("ProcessesRegistryError")<{
  readonly message: string;
}> {}

export class ProcessesService extends Context.Service<
  ProcessesService,
  {
    /** Live entries from the shared pid registry, dead claims pruned. */
    list: Effect.Effect<PidEntry[], ProcessesRegistryError>;
  }
>()("bos/ProcessesService") {
  static Live = Layer.succeed(
    ProcessesService,
    ProcessesService.of({
      list: Effect.try({
        try: readRegistry,
        // Non-Error throws keep the legacy "Unknown error" wording.
        catch: (error) =>
          new ProcessesRegistryError({
            message: error instanceof Error ? error.message : "Unknown error",
          }),
      }).pipe(Effect.flatMap(pruneDeadEffect)),
    }),
  );
}
