export const orgMembersQueryKey = (orgId: string) => ["org-members", orgId] as const;
export const orgInvitationsQueryKey = (orgId: string) => ["org-invitations", orgId] as const;
export const orgApiKeysQueryKey = (orgId: string) => ["org-api-keys", orgId] as const;
export const orgTeamsQueryKey = (orgId: string) => ["org-teams", orgId] as const;
export const orgTeamMembersQueryKey = (teamId: string) => ["org-team-members", teamId] as const;
