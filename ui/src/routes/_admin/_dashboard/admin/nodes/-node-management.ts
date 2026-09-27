export function parseNodeMetadata(raw: string, description: string): Record<string, unknown> {
  let metadata: unknown;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw new Error("Metadata must be valid JSON.");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Metadata must be a JSON object.");
  }
  const result: Record<string, unknown> = { ...metadata };
  if (description.trim()) result.description = description.trim();
  else delete result.description;
  return result;
}

interface SearchableNodeRow {
  node: { name: string; slug: string };
  parent?: { name: string } | undefined;
}

export function filterNodeRows<T extends SearchableNodeRow>(
  rows: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    ({ node, parent }) =>
      node.name.toLowerCase().includes(needle) ||
      node.slug.toLowerCase().includes(needle) ||
      !!parent?.name.toLowerCase().includes(needle),
  );
}

export const NODE_DETAIL_TABS = ["overview", "validators", "domains", "profile"] as const;

export type NodeDetailTab = (typeof NODE_DETAIL_TABS)[number];

export function parseNodeDetailTab(value: unknown): NodeDetailTab | undefined {
  return NODE_DETAIL_TABS.find((tab) => tab === value);
}
