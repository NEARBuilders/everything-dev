export const organizationsQueryKey = ["organizations"] as const;
export const userInvitationsQueryKey = ["user-invitations"] as const;
export const permissionRegistryQueryKey = ["permission-registry"] as const;
export const adminOrganizationsQueryKey = ["admin-organizations"] as const;
export const orgWorkspaceQueryKey = (mode: string, ref: string) =>
  ["org-workspace", mode, ref] as const;
export const orgTeamMembersQueryKey = (mode: string, teamId: string) =>
  ["org-team-members", mode, teamId] as const;
export const orgApiKeysQueryKey = (orgId: string) => ["org-api-keys", orgId] as const;
