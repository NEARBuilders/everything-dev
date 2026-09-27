import { describe, expect, it } from "vitest";
import { getNodeEmptyStateContent } from "./-node-empty-state";

describe("My community empty state", () => {
  it("sends viewers without an organization to organization creation", () => {
    expect(getNodeEmptyStateContent("no-org", false)).toMatchObject({
      actionLabel: "Create organization",
      actionTo: "/orgs/new",
    });
  });

  it.each([
    { reason: "no-tenant", canCreateNode: true, actionTo: "/admin/tenants/new" },
    { reason: "no-node", canCreateNode: true, actionTo: "/admin/tenants/new" },
    { reason: "no-tenant", canCreateNode: false, actionTo: "/apply" },
    { reason: "no-node", canCreateNode: false, actionTo: "/apply" },
  ] as const)("sends $reason (admin: $canCreateNode) to $actionTo", (scenario) => {
    expect(getNodeEmptyStateContent(scenario.reason, scenario.canCreateNode).actionTo).toBe(
      scenario.actionTo,
    );
  });

  it("offers members Start a community", () => {
    expect(getNodeEmptyStateContent("no-node", false).actionLabel).toBe("Start a community");
  });
});
