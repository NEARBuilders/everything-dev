import { Data } from "effect";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  stage: "driver" | "migration" | "load" | "close";
  migrationTag?: string;
  statementIndex?: number;
  cause: unknown;
}> {
  override get message() {
    const parts = [`DatabaseError [stage=${this.stage}]`];
    if (this.migrationTag) parts.push(`migration=${this.migrationTag}`);
    if (this.statementIndex !== undefined) parts.push(`statement=${this.statementIndex}`);
    parts.push(unwrapDatabaseError(this.cause));
    return parts.join(": ");
  }
}

/** Stringify a non-Error value without ever throwing (#798): null-prototype
 * objects have no primitive conversion, so `String()` itself throws a
 * TypeError that would replace the real error everywhere `.message` is read. */
function stringifyUnknown(value: unknown): string {
  try {
    return String(value);
  } catch {
    try {
      return JSON.stringify(value) ?? "[unserializable cause]";
    } catch {
      return "[unserializable cause]";
    }
  }
}

export function unwrapDatabaseError(error: unknown): string {
  if (!(error instanceof Error)) return stringifyUnknown(error);
  const parts = [error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = cause.cause;
  }
  if (cause !== undefined && cause !== null) {
    // the tail of a cause chain can be a non-Error (a rewrapped fiber
    // failure, a null-prototype object) — append it instead of dropping it
    parts.push(stringifyUnknown(cause));
  }
  return parts.join(": ");
}
