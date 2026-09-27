import { describe, expect, it } from "vitest";
import { getNextSteps, type NextStepsState } from "./-next-steps";

const base: NextStepsState = {
  isAnonymous: false,
  hasPasskey: true,
  hasNear: false,
  organizationCount: 1,
  activeOrganizationName: "Harbor",
  community: null,
  canManageCommunity: false,
  isAdmin: false,
};

const ids = (state: Partial<NextStepsState>) =>
  getNextSteps({ ...base, ...state }).map((step) => step.id);

describe("home next steps", () => {
  it("asks an anonymous user without a sign-in method to save the account first", () => {
    expect(ids({ isAnonymous: true, hasPasskey: false })[0]).toBe("save-account");
    expect(ids({ isAnonymous: true, hasPasskey: false, hasNear: true })).not.toContain(
      "save-account",
    );
  });

  it("sends a user without organizations to create one", () => {
    expect(ids({ organizationCount: 0, activeOrganizationName: null })).toEqual([
      "create-org",
      "stake",
      "explore",
    ]);
  });

  it("asks a member of several organizations to pick an active one", () => {
    expect(ids({ organizationCount: 2, activeOrganizationName: null })[0]).toBe("choose-org");
  });

  it("offers Start a community when the active organization has no community", () => {
    expect(ids({})).toEqual(["start-community", "stake", "explore"]);
  });

  it("opens My community once the organization runs one", () => {
    expect(ids({ community: { name: "Harbor City", tenantId: "t1" } })).toEqual([
      "open-community",
      "stake",
    ]);
  });

  it("adds Community settings for owners and the admin queue for admins", () => {
    expect(
      ids({
        community: { name: "Harbor City", tenantId: "t1" },
        canManageCommunity: true,
        isAdmin: true,
      }),
    ).toEqual(["open-community", "community-settings", "admin", "stake"]);
  });
});
