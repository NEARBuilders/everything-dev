import type { AuthApiClient } from "@/lib/api";
import type {
  ApiKeyRow,
  InvitationRow,
  MemberRow,
  OrgInfo,
  OrgRole,
  OrgStatus,
  TeamMemberRow,
  TeamRow,
} from "./types";

export type WorkspaceMode = "member" | "admin";

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("Organization not found");
    this.name = "OrganizationNotFoundError";
  }
}

export interface WorkspaceSnapshot {
  org: OrgInfo;
  members: MemberRow[];
  invitations: InvitationRow[];
  teams: TeamRow[];
  myRole: string | null;
}

export interface InviteInput {
  email?: string;
  nearAccountId?: string;
  nearNetwork?: "mainnet" | "testnet";
  role: OrgRole;
  teamId?: string;
  resend?: boolean;
}

export interface OrgWorkspaceCapabilities {
  invite: boolean;
  addMember: boolean;
  manageInvitations: boolean;
  apiKeys: boolean;
  leave: boolean;
  switchActive: boolean;
  exportMembers: boolean;
  setStatus: boolean;
}

export interface OrgWorkspaceAdapter {
  mode: WorkspaceMode;
  capabilities: OrgWorkspaceCapabilities;
  loadSnapshot(ref: string, viewerUserId: string | undefined): Promise<WorkspaceSnapshot>;
  teamMembers(teamId: string): Promise<TeamMemberRow[]>;
  updateOrganization(input: {
    orgId: string;
    name: string;
    slug: string;
    status?: OrgStatus;
  }): Promise<void>;
  deleteOrganization(orgId: string): Promise<void>;
  updateMemberRole(input: { orgId: string; member: MemberRow; role: OrgRole }): Promise<void>;
  removeMember(input: { orgId: string; member: MemberRow }): Promise<void>;
  addMember(input: { orgId: string; userId: string; role: OrgRole }): Promise<void>;
  inviteMember(orgId: string, input: InviteInput): Promise<void>;
  cancelInvitation(invitationId: string): Promise<void>;
  createTeam(input: { orgId: string; name: string; areas: string[] }): Promise<TeamRow>;
  updateTeam(input: {
    orgId: string;
    teamId: string;
    name?: string;
    areas?: string[];
  }): Promise<void>;
  deleteTeam(input: { orgId: string; teamId: string }): Promise<void>;
  addTeamMember(input: { orgId: string; teamId: string; userId: string }): Promise<void>;
  removeTeamMember(input: { orgId: string; teamId: string; userId: string }): Promise<void>;
  listApiKeys(orgId: string): Promise<ApiKeyRow[]>;
}

const MANAGER_ROLES = ["owner", "admin"];

export function isManagerRole(role: string | null | undefined) {
  return role !== null && role !== undefined && MANAGER_ROLES.includes(role);
}

function unsupported(feature: string): never {
  throw new Error(`${feature} is not available here`);
}

export function createMemberAdapter(api: AuthApiClient): OrgWorkspaceAdapter {
  return {
    mode: "member",
    capabilities: {
      invite: true,
      addMember: false,
      manageInvitations: true,
      apiKeys: true,
      leave: true,
      switchActive: true,
      exportMembers: true,
      setStatus: false,
    },

    async loadSnapshot(slug, viewerUserId) {
      const organizations = await api.listOrganizations();
      const org = organizations.find((candidate) => candidate.slug === slug);
      if (!org) throw new OrganizationNotFoundError();
      const [{ members }, teams] = await Promise.all([
        api.listMembers({ organizationId: org.id }),
        api.listTeams({ organizationId: org.id }),
      ]);
      const myRole = members.find((member) => member.userId === viewerUserId)?.role ?? null;
      const invitations = isManagerRole(myRole)
        ? await api.listInvitations({ organizationId: org.id })
        : [];
      return { org, members, invitations, teams, myRole };
    },

    teamMembers: (teamId) => api.listTeamMembers({ teamId }),

    async updateOrganization({ orgId, name, slug }) {
      await api.updateOrganization({ organizationId: orgId, data: { name, slug } });
    },
    async deleteOrganization(orgId) {
      await api.deleteOrganization({ organizationId: orgId });
    },

    async updateMemberRole({ orgId, member, role }) {
      await api.updateMemberRole({ memberId: member.id, organizationId: orgId, role });
    },
    async removeMember({ orgId, member }) {
      await api.removeMember({
        memberIdOrEmail: member.user?.email ?? member.userId,
        organizationId: orgId,
      });
    },
    addMember: () => unsupported("Adding a member by user id"),

    async inviteMember(orgId, input) {
      await api.inviteMember({
        organizationId: orgId,
        role: input.role,
        ...(input.email ? { email: input.email } : {}),
        ...(input.nearAccountId
          ? { nearAccountId: input.nearAccountId, nearNetwork: input.nearNetwork }
          : {}),
        ...(input.teamId ? { teamId: input.teamId } : {}),
        ...(input.resend ? { resend: true } : {}),
      });
    },
    async cancelInvitation(invitationId) {
      await api.cancelInvitation({ invitationId });
    },

    createTeam: ({ orgId, name, areas }) => api.createTeam({ organizationId: orgId, name, areas }),
    async updateTeam({ orgId, teamId, name, areas }) {
      await api.updateTeam({
        teamId,
        organizationId: orgId,
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(areas !== undefined ? { areas } : {}),
        },
      });
    },
    async deleteTeam({ orgId, teamId }) {
      await api.deleteTeam({ teamId, organizationId: orgId });
    },
    async addTeamMember({ orgId, teamId, userId }) {
      await api.addTeamMember({ teamId, userId, organizationId: orgId });
    },
    async removeTeamMember({ orgId, teamId, userId }) {
      await api.removeTeamMember({ teamId, userId, organizationId: orgId });
    },

    listApiKeys: (orgId) => api.listApiKeys({ organizationId: orgId, configId: "org-keys" }),
  };
}

export function createAdminAdapter(api: AuthApiClient): OrgWorkspaceAdapter {
  return {
    mode: "admin",
    capabilities: {
      invite: false,
      addMember: true,
      manageInvitations: false,
      apiKeys: false,
      leave: false,
      switchActive: false,
      exportMembers: false,
      setStatus: true,
    },

    async loadSnapshot(orgId) {
      const full = await api.adminGetOrganizationFull({ organizationId: orgId }).catch((error) => {
        if (error instanceof Error && /not found/i.test(error.message)) {
          throw new OrganizationNotFoundError();
        }
        throw error;
      });
      const { members, invitations, teams, ...org } = full;
      return { org, members, invitations, teams, myRole: null };
    },

    teamMembers: (teamId) => api.adminListTeamMembers({ teamId }),

    async updateOrganization({ orgId, name, slug, status }) {
      await api.adminUpdateOrganization({
        organizationId: orgId,
        data: { name, slug, ...(status ? { status } : {}) },
      });
    },
    async deleteOrganization(orgId) {
      await api.adminDeleteOrganization({ organizationId: orgId });
    },

    async updateMemberRole({ orgId, member, role }) {
      await api.adminUpdateMemberRole({
        organizationId: orgId,
        userId: member.userId,
        role,
      });
    },
    async removeMember({ orgId, member }) {
      await api.adminRemoveMember({ organizationId: orgId, userId: member.userId });
    },
    async addMember({ orgId, userId, role }) {
      await api.adminAddMember({ organizationId: orgId, userId, role });
    },

    inviteMember: () => unsupported("Inviting from the admin console"),
    cancelInvitation: () => unsupported("Cancelling invitations from the admin console"),

    createTeam: ({ orgId, name, areas }) =>
      api.adminCreateTeam({ organizationId: orgId, name, metadata: { areas } }),
    async updateTeam({ teamId, name, areas }) {
      await api.adminUpdateTeam({
        teamId,
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(areas !== undefined ? { metadata: { areas } } : {}),
        },
      });
    },
    async deleteTeam({ teamId }) {
      await api.adminDeleteTeam({ teamId });
    },
    async addTeamMember({ teamId, userId }) {
      await api.adminAddTeamMember({ teamId, userId });
    },
    async removeTeamMember({ teamId, userId }) {
      await api.adminRemoveTeamMember({ teamId, userId });
    },

    listApiKeys: () => Promise.resolve([]),
  };
}
