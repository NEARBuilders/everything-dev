export type ReviewStatus = "pending" | "approved" | "rejected" | "removed";
export type ApplyStatus = "not_started" | "applying" | "applied" | "failed";

export function proposalTitle(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const key of ["title", "name", "slug"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const keys = Object.keys(record);
    if (keys.length > 0) {
      const shown = keys.slice(0, 3).join(", ");
      return `Change ${shown}${keys.length > 3 ? ` and ${keys.length - 3} more` : ""}`;
    }
  }
  return fallback;
}

export function reviewStatusBadge(status: ReviewStatus) {
  if (status === "pending") return { label: "Awaiting review", variant: "warning" as const };
  if (status === "approved") return { label: "Approved", variant: "success" as const };
  if (status === "rejected") return { label: "Rejected", variant: "destructive" as const };
  return { label: "Removed", variant: "outline" as const };
}

export function applyStatusLabel(status: ApplyStatus): string | null {
  if (status === "applying") return "Applying";
  if (status === "applied") return "Live";
  if (status === "failed") return "Failed to apply";
  return null;
}

export function sortProposals<T extends { reviewStatus: ReviewStatus; createdAt: string }>(
  proposals: readonly T[],
): T[] {
  return [...proposals].sort((a, b) => {
    const pending = Number(b.reviewStatus === "pending") - Number(a.reviewStatus === "pending");
    return pending || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}
