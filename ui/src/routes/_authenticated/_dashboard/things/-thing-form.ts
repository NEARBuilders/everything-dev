export const DEFAULT_THING_PAYLOAD = '{\n  "kind": "demo",\n  "value": "hello"\n}';

export type PayloadParse = { ok: true; value: unknown } | { ok: false; error: string };

export function parseThingPayload(raw: string): PayloadParse {
  if (!raw.trim()) return { ok: false, error: "Payload is required" };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return { ok: false, error: detail ? `Invalid JSON: ${detail}` : "Invalid JSON" };
  }
}

export function formatThingPayload(raw: string): string {
  const parsed = parseThingPayload(raw);
  return parsed.ok ? JSON.stringify(parsed.value, null, 2) : raw;
}

export function isSignInError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, status } = error as { code?: unknown; status?: unknown };
  return code === "UNAUTHORIZED" || status === 401;
}
