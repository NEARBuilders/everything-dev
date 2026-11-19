export const DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT = 100;

export type OrganizationMembershipLimitInput = number | null | false;

export interface OrganizationMembershipPolicy {
  limit: number;
  hasCapacity(memberCount: number): boolean;
}

export function createOrganizationMembershipPolicy(
  configuredLimit: OrganizationMembershipLimitInput = DEFAULT_ORGANIZATION_MEMBERSHIP_LIMIT,
): OrganizationMembershipPolicy {
  if (configuredLimit === null || configuredLimit === false) {
    return {
      limit: Infinity,
      hasCapacity: () => true,
    };
  }

  if (!Number.isInteger(configuredLimit) || configuredLimit < 1) {
    throw new Error("Organization membership limit must be a positive integer");
  }

  return {
    limit: configuredLimit,
    hasCapacity: (memberCount) => memberCount < configuredLimit,
  };
}
