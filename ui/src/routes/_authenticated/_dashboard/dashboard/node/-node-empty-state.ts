type NodeDashboardEmptyReason = "no-org" | "no-tenant" | "no-node";

export function getNodeEmptyStateContent(reason: NodeDashboardEmptyReason, canCreateNode: boolean) {
  if (reason === "no-org") {
    return {
      title: "Create an organization first",
      description: "Communities are run by organizations. Start one, then start a community.",
      actionLabel: "Create organization",
      actionTo: "/orgs/new" as const,
    };
  }

  return {
    title: "Your organization has no community yet",
    description: canCreateNode
      ? "Create a City Node for this organization."
      : "Propose a City Node for your organization to run.",
    actionLabel: canCreateNode ? "Create community" : "Start a community",
    actionTo: canCreateNode ? ("/admin/tenants/new" as const) : ("/apply" as const),
  };
}
