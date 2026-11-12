/**
 * Stringify an unknown error value for CLI output. A plain-object rejection
 * coerces to "[object Object]" in a template literal; a structured payload
 * (Zod results, `{ message, stack }` shapes, result `error` fields) must
 * render its actual content or the real failure is swallowed.
 */
export function formatUnknownError(error: unknown): string {
  if (error === null || error === undefined || error === "") return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (typeof error === "symbol") return error.description ?? "Symbol";
  if (error instanceof Error) {
    const parts = [error.message || error.name];
    if (error.cause !== undefined && error.cause !== null) {
      parts.push(`(cause: ${formatUnknownError(error.cause)})`);
    }
    return parts.join(" ");
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === "string" && record.message.trim() !== ""
        ? record.message
        : typeof record.error === "string" && record.error.trim() !== ""
          ? record.error
          : null;
    if (message) return message;
    try {
      const serialized = JSON.stringify(error, null, 2);
      if (serialized && serialized !== "{}" && serialized !== "[]") return serialized;
    } catch {
      // circular or non-serializable — fall through to the tagged form
    }
    return Object.prototype.toString.call(error);
  }
  return Object.prototype.toString.call(error);
}
