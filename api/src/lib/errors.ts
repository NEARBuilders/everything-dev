import { ORPCError } from "@orpc/server";
export function toOrpcError(error: unknown): ORPCError<string, unknown> {
  return error instanceof ORPCError
    ? error
    : new ORPCError("INTERNAL_SERVER_ERROR", {
        message: error instanceof Error ? error.message : String(error),
      });
}

interface PostgresError {
  code?: string;
  constraint?: string;
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const cause = (error as { cause?: unknown }).cause ?? error;
  const candidate = cause as PostgresError;
  return candidate.code === "23505";
}
