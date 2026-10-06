const MAX_CAUSE_DEPTH = 5;

/**
 * Human-readable message for anything thrown or failed. Effect tagged errors
 * (`Schema.TaggedError`) often carry an empty `message` and keep the detail in
 * `_tag` / `phase` / `cause`, so `error instanceof Error ? error.message : …`
 * collapses them to nothing; this walks the cause chain instead.
 */
export function describeError(error: unknown, depth = 0): string {
  if (depth > MAX_CAUSE_DEPTH) return "";
  if (typeof error === "string") return error.trim() || (depth === 0 ? "Unknown error" : "");
  if (error === null || error === undefined || typeof error !== "object") {
    return depth === 0 ? (error === undefined ? "Unknown error" : String(error)) : "";
  }

  const record = error as { message?: unknown; _tag?: unknown; phase?: unknown; cause?: unknown };
  const message = typeof record.message === "string" ? record.message.trim() : "";
  const tag = typeof record._tag === "string" ? record._tag : "";
  const phase = typeof record.phase === "string" ? record.phase : "";
  const label = message || (tag ? (phase ? `${tag} (${phase})` : tag) : "");
  const cause =
    record.cause !== undefined && record.cause !== error
      ? describeError(record.cause, depth + 1)
      : "";

  const parts = label && cause && !label.includes(cause) ? `${label}: ${cause}` : label || cause;
  if (parts) return parts;
  return depth === 0 ? "Unknown error" : "";
}
