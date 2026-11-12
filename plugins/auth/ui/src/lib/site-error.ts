const DETAIL_FIELDS = ["detail", "detailFull"] as const;

export interface SiteErrorFields {
  message: string | null;
  detail: string | null;
}

/**
 * Pull the human message and technical detail out of the error shapes the
 * server emits through the better-fetch client: a non-OK response spreads the
 * body fields into the error object, so the host's 503 arrives as
 * `{ error, message, detail, detailFull, status }`. Ceremony-level errors are
 * `Error` instances with only a message. Returns nulls when nothing matches.
 *
 * A `TypeError` is the fetch layer's own network failure ("Failed to fetch",
 * "Load failed") — it carries no server words, so it yields nulls and the
 * caller's translated fallback line applies.
 */
export function extractSiteError(error: unknown): SiteErrorFields {
  if (error === null || error === undefined) return { message: null, detail: null };
  if (error instanceof TypeError) return { message: null, detail: null };
  if (error instanceof Error) return { message: error.message || null, detail: null };
  if (typeof error !== "object") return { message: null, detail: null };
  const record = error as Record<string, unknown>;
  const message =
    typeof record.message === "string" && record.message.trim() !== "" ? record.message : null;
  const detail =
    DETAIL_FIELDS.map((field) => record[field]).find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    ) ?? null;
  return { message, detail };
}

/** The translated fallback line when the error carries no server message. */
export function siteErrorMessage(
  error: unknown,
  fallback: string,
): { message: string; detail: string | null } {
  const fields = extractSiteError(error);
  return { message: fields.message ?? fallback, detail: fields.detail };
}
