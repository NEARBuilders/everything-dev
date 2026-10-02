export const applyStepIds = ["organization", "near", "dao", "details"] as const;

export type ApplyStepId = (typeof applyStepIds)[number];
export type ApplyStepStatus = "complete" | "current" | "upcoming";

export function resolveApplySteps(
  done: { organization: boolean; near: boolean; dao: boolean },
  reopened: ApplyStepId | null,
) {
  const complete: Record<ApplyStepId, boolean> = { ...done, details: false };
  const firstOpen = applyStepIds.find((id) => !complete[id]) ?? "details";
  const reachable = applyStepIds.indexOf(firstOpen);
  const current =
    reopened && applyStepIds.indexOf(reopened) <= reachable && complete[reopened]
      ? reopened
      : firstOpen;
  const status = (id: ApplyStepId): ApplyStepStatus =>
    id === current ? "current" : complete[id] ? "complete" : "upcoming";
  return {
    current,
    position: applyStepIds.indexOf(current) + 1,
    status,
  };
}
