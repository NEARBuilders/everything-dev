export const FEATURE_AREAS = ["node-operations", "finance", "things", "stake", "events"] as const;

export type FeatureArea = (typeof FEATURE_AREAS)[number];

export const FEATURE_AREA_LABELS: Record<FeatureArea, string> = {
  "node-operations": "Node operations",
  finance: "Finance",
  things: "Things",
  stake: "Stake",
  events: "Events",
};

export function isFeatureArea(value: string): value is FeatureArea {
  return (FEATURE_AREAS as readonly string[]).includes(value);
}
