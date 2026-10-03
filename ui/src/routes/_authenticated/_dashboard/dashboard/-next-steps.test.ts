import { describe, expect, it } from "vitest";
import { getNextSteps, type NextStepsState } from "./-next-steps";

const base: NextStepsState = {
  isAnonymous: false,
  hasPasskey: true,
  hasNear: false,
  hasRealEmail: true,
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

  it("nudges a signed-in user without a real email to add one", () => {
    expect(ids({ hasRealEmail: false })).toContain("add-email");
    expect(ids({ hasRealEmail: true })).not.toContain("add-email");
    expect(ids({ isAnonymous: true, hasRealEmail: false })).not.toContain("add-email");
  });

  it("offers Things once an organization is active", () => {
    expect(ids({})).toEqual(["open-things"]);
  });

  it("adds the admin step for admins only", () => {
    expect(ids({ isAdmin: true })).toEqual(["open-things", "admin"]);
    expect(ids({ isAdmin: false })).not.toContain("admin");
  });
});
