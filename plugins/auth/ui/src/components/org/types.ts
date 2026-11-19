import type { AuthApiClient } from "@/lib/api";

type Output<K extends keyof AuthApiClient> = Awaited<ReturnType<AuthApiClient[K]>>;

export type OrgInfo = Output<"listOrganizations">[number];
export type MemberRow = Output<"listMembers">["members"][number];
export type InvitationRow = Output<"listInvitations">[number];
export type UserInvitationRow = Output<"listUserInvitations">[number];
export type TeamRow = Output<"listTeams">[number];
export type TeamMemberRow = Output<"listTeamMembers">[number];
export type ApiKeyRow = Output<"listApiKeys">[number];
export type PermissionRegistry = Output<"getPermissionRegistry">;
export type OrgRole = "owner" | "admin" | "member";
export type OrgStatus = "active" | "pending" | "rejected";

export const ORG_ROLES: OrgRole[] = ["owner", "admin", "member"];
