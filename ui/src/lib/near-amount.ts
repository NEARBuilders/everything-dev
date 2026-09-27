const YOCTO_PER_NEAR = 10n ** 24n;
const MAX_U128 = (1n << 128n) - 1n;

export function parseNearAmount(value: string): bigint | null {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return null;

  const wholePart = BigInt(match[1]);
  const fractionalPart = match[2] ?? "";
  if (fractionalPart.length > 24) return null;

  const yocto = wholePart * YOCTO_PER_NEAR + BigInt(fractionalPart.padEnd(24, "0") || "0");
  if (yocto <= 0n || yocto > MAX_U128) return null;
  return yocto;
}
