import { Cause } from "effect";
export function extractErrorDetails(error: unknown): {
  message: string;
  stack?: string;
  cause?: string;
} {
  if (!error) return { message: "Unknown error (null/undefined)" };

  if (error instanceof Error) {
    const details: { message: string; stack?: string; cause?: string } = {
      message: error.message || error.name || "Error",
      stack: error.stack,
    };

    if (error.cause) {
      if (error.cause instanceof Error) {
        details.cause = `${error.cause.name}: ${error.cause.message}`;
      } else if (typeof error.cause === "object" && "_tag" in (error.cause as object)) {
        try {
          const squashed = Cause.squash(error.cause as Cause.Cause<unknown>);
          if (squashed instanceof Error) {
            details.cause = `[Effect] ${squashed.name}: ${squashed.message}`;
          } else {
            details.cause = `[Effect] ${String(squashed)}`;
          }
        } catch {
          details.cause = `[Effect Cause] ${JSON.stringify(error.cause)}`;
        }
      } else {
        details.cause = JSON.stringify(error.cause) ?? "[Unserializable cause]";
      }
    }

    return details;
  }

  if (typeof error === "object" && error !== null) {
    if ("_tag" in error) {
      try {
        const squashed = Cause.squash(error as unknown as Cause.Cause<unknown>);
        return extractErrorDetails(squashed);
      } catch {
        return { message: `[Effect] ${JSON.stringify(error)}` };
      }
    }

    if ("message" in error) {
      return { message: String((error as { message: unknown }).message) };
    }

    return { message: JSON.stringify(error) };
  }

  if (typeof error === "string") return { message: error };
  if (typeof error === "symbol") return { message: error.description ?? "" };
  if (typeof error === "number" || typeof error === "bigint" || typeof error === "boolean") {
    return { message: `${error}` };
  }
  return { message: "Unknown error" };
}

/**
 * Normalize any caught value into an Error. Throwables reach catch blocks in
 * non-Error shapes (hono/node-server aborts the request signal with the raw
 * `incoming.errored` string, and TanStack's `throwIfAborted` rethrows
 * `signal.reason` verbatim), so downstream code cannot rely on `.message`
 * without this normalization at the seam.
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(extractErrorDetails(error).message);
}

const CLIENT_ABORT_MESSAGES = new Set([
  "Error: aborted",
  "aborted",
  "Client connection prematurely closed.",
  "This operation was aborted",
]);

/**
 * Whether a caught value is a client disconnect rather than a server fault:
 * the client closed the socket mid-request, so the response cannot be
 * delivered no matter what we render. Matches @hono/node-server's abort
 * reasons (delivered as plain strings through the request signal) and
 * standard AbortError instances.
 */
export function isClientAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return message ? CLIENT_ABORT_MESSAGES.has(message) : false;
}
