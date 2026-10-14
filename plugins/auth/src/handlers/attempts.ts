import { ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { toORPCError } from "../utils";

export const attemptAuth = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => toORPCError(error),
  });

export const attemptDb = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      error instanceof ORPCError
        ? error
        : new ORPCError("INTERNAL_SERVER_ERROR", {
            message: error instanceof Error ? error.message : "Database error",
          }),
  });
