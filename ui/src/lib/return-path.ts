export function returnPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (value.startsWith("/onboarding/station/")) return undefined;
  return value;
}
