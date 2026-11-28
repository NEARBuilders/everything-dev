/** Parses a yoctoNEAR amount — integer text only. Undefined marks an
 * unreadable amount, never zero: RPC responses lie (fastnear's free RPC once
 * answered a balance query with "1.28"), and BigInt throws on exactly those
 * decimal and scientific-notation strings. The caller decides the fallback
 * for undefined — soft-skip for advisory checks, fail loud for gates. */
export const parseYocto = (text: string): bigint | undefined => {
  const digits = text.trim();
  return /^\d+$/.test(digits) ? BigInt(digits) : undefined;
};
