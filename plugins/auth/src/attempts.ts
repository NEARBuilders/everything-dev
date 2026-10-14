import { Effect } from "effect";
import { AuthApiError, DbError, isAuthFailure } from "./services/domain-errors";
import { toAuthApiError } from "./utils";

export const attemptAuth = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => (isAuthFailure(error) ? error : toAuthApiError(error)),
  });

export const attemptDb = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => {
      if (isAuthFailure(error)) return error;
      return new DbError({
        message: error instanceof Error ? error.message : "Database error",
        cause: error,
      });
    },
  });
