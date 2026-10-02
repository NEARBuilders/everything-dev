import { describe, expect, it } from "vitest";
import { getActiveOrganizationNodeId, getStakeScopeKey } from "./-stake-selection";

describe("stake community selection", () => {
  it("uses the public scope for signed-out and anonymous visitors", () => {
    expect(getStakeScopeKey(null, null)).toBe("anonymous");
    expect(getStakeScopeKey({ id: "guest", isAnonymous: true }, null)).toBe("anonymous");
  });

  it("separates active organization and membership fallback caches", () => {
    expect(getStakeScopeKey({ id: "user-1" }, "org-1")).toBe("organization:org-1");
    expect(getStakeScopeKey({ id: "user-1" }, null)).toBe("user:user-1");
  });

  it("defaults only an unselected active organization to its community node", () => {
    const communities = [{ node: { id: "node-1" } }, { node: { id: "node-2" } }];
    expect(
      getActiveOrganizationNodeId({
        activeOrganizationId: "org-1",
        communities,
        hasRequestedNode: false,
      }),
    ).toBe("node-1");
    expect(
      getActiveOrganizationNodeId({
        activeOrganizationId: "org-1",
        communities,
        hasRequestedNode: true,
      }),
    ).toBeNull();
    expect(
      getActiveOrganizationNodeId({
        activeOrganizationId: null,
        communities,
        hasRequestedNode: false,
      }),
    ).toBeNull();
  });
});
