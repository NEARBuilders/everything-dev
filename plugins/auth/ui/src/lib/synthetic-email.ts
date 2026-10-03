export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  const lower = email.toLowerCase();
  if (/^passkey-[0-9a-f]{8}@/.test(lower)) return true;
  if (/^temp-[0-9a-f]+@/.test(lower)) return true;
  if (lower.endsWith("@near.email")) return true;
  return false;
}
