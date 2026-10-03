export function sanitizeUserCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/-/g, "").toUpperCase();
  return /^[A-Z2-9]{4,12}$/.test(cleaned) ? cleaned : undefined;
}
