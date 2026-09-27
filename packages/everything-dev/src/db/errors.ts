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

export function unwrapDatabaseError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  let cause: unknown = error.cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(": ");
}
