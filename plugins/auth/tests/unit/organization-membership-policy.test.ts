import { describe, expect, it } from "vitest";
import {
  createOrganizationMembershipPolicy,
  DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT,
} from "../../src/organization-membership-policy";

describe("createOrganizationMembershipPolicy", () => {
  it("defaults to the platform limit when the variable is unset", () => {
    const policy = createOrganizationMembershipPolicy();
    expect(policy.limit).toBe(DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT);
    expect(policy.hasCapacity(DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT - 1)).toBe(true);
    expect(policy.hasCapacity(DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT)).toBe(false);
  });

  it("keeps an explicit positive integer as the limit", () => {
    const policy = createOrganizationMembershipPolicy(2);
    expect(policy.limit).toBe(2);
    expect(policy.hasCapacity(1)).toBe(true);
    expect(policy.hasCapacity(2)).toBe(false);
  });

  it.each([null, false] as const)("treats %p as no limit", (offValue) => {
    const policy = createOrganizationMembershipPolicy(offValue);
    expect(policy.hasCapacity(0)).toBe(true);
    expect(policy.hasCapacity(DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT)).toBe(true);
    expect(policy.hasCapacity(1_000_000)).toBe(true);
  });

  it.each([0, -1, Infinity])("rejects %p as a limit", (badValue) => {
    expect(() => createOrganizationMembershipPolicy(badValue)).toThrow(
      /must be a positive integer/,
    );
  });
});
