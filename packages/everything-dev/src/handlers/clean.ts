import { Effect } from "effect";
import type { CleanResult } from "../contract";
import { executeClean } from "../services/clean";
import type { BosBuilder } from "./shared";

export function registerClean(builder: BosBuilder) {
  return {
    clean: builder.clean.effect(function* (_opts, input) {
      return yield* Effect.try({
        try: () => executeClean(input.configDir ?? process.cwd(), { dryRun: input.dryRun }),
        catch: (error) => ({
          status: "error" as const,
          dryRun: input.dryRun,
          entries: [],
          freedBytes: 0,
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    }),
  };
}
