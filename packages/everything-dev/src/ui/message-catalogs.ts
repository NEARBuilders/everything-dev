export function createMessageCatalogs<
  const Locales extends readonly string[],
  const Entries extends Record<string, { [Index in keyof Locales]: string }>,
>(locales: Locales, entries: Entries) {
  return Object.fromEntries(
    locales.map((locale, index) => [
      locale,
      Object.fromEntries(Object.entries(entries).map(([id, messages]) => [id, messages[index]])),
    ]),
  ) as { [Locale in Locales[number]]: { [Id in keyof Entries]: string } };
}
