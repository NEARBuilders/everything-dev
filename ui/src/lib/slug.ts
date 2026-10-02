export function generateSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveSlug(name: string, currentSlug: string, manuallyEdited: boolean) {
  return manuallyEdited ? currentSlug : generateSlug(name);
}

/**
 * Finds the first available slug for `base`, suffixing `-2`, `-3`, … when the
 * base or earlier candidates are taken. Shared by org creation and node
 * applications so one collision strategy backs every slug in the app.
 */
export async function suggestAvailableSlug(
  base: string,
  isTaken: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  if (!base) return "";
  if (!(await isTaken(base))) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
