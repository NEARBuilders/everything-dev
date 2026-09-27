export function filterThings<T extends { thingId: string; type: string }>(
  things: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...things];
  return things.filter(
    (thing) =>
      thing.thingId.toLowerCase().includes(needle) || thing.type.toLowerCase().includes(needle),
  );
}
