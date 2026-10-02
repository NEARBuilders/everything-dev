export const geoNodeKinds = ["country", "state", "city"] as const;

const GEO_KIND_LABELS: Record<string, string> = {
  country: "Country",
  state: "State",
  city: "City",
};

export function nodeKindLabel(kind: string | null | undefined, fallback = "Community"): string {
  if (!kind) return fallback;
  return GEO_KIND_LABELS[kind] ?? kind;
}
