export function hasNodeProposalReviewPermission(role: string | null | undefined): boolean {
  return role === "admin";
}
