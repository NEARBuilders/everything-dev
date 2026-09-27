export type OnboardingCodeState = "active" | "expired" | "revoked" | "used-up";

export function onboardingCodeState(
  code: { expiresAt: Date; revokedAt: Date | null; usedCount: number; maxUses: number },
  now: number = Date.now(),
): OnboardingCodeState {
  if (code.revokedAt) return "revoked";
  if (new Date(code.expiresAt).getTime() < now) return "expired";
  if (code.usedCount >= code.maxUses) return "used-up";
  return "active";
}

export function formatRemaining(expiresAt: Date, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
