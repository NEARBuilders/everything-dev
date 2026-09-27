import { describe, expect, it } from "vitest";
import { getNextSteps, type NextStepsState } from "./-next-steps";

const base: NextStepsState = {
  isAnonymous: false,
  hasPasskey: true,
  hasNear: false,
  organizationCount: 1,
  activeOrganizationName: "Harbor",
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
    expect(ids({ organizationCount: 0, activeOrganizationName: null })).toEqual(["create-org"]);
  });

  it("asks a member of several organizations to pick an active one", () => {
    expect(ids({ organizationCount: 2, activeOrganizationName: null })[0]).toBe("choose-org");
  });

  it("stays quiet once the user has an active organization", () => {
    expect(ids({})).toEqual([]);
  });

  it("adds the admin queue for admins", () => {
    expect(ids({ isAdmin: true })).toEqual(["admin"]);
  });
});
