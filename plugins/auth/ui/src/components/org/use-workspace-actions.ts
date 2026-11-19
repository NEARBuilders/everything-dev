import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { organizationsQueryKey, orgTeamMembersQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";
import type { InviteInput } from "./adapter";
import type { InvitationRow, MemberRow, OrgRole, OrgStatus } from "./types";
import { useOrgWorkspace } from "./workspace-context";

const failure = (fallback: string) => (error: Error) => toast.error(error.message || fallback);

export function useWorkspaceActions() {
  const workspace = useOrgWorkspace();
  const { adapter, org, refresh, mode } = workspace;
  const api = useAuthApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgId = org.id;

  const leaveWorkspace = () =>
    mode === "admin" ? router.navigate({ to: "/admin/orgs" }) : router.navigate({ to: "/orgs" });

  const updateOrganization = useMutation({
    mutationFn: (input: { name: string; slug: string; status?: OrgStatus }) =>
      adapter.updateOrganization({ orgId, ...input }),
    onSuccess: async (_, input) => {
      toast.success("Organization updated");
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      if (mode === "member" && input.slug !== org.slug) {
        await router.navigate({ to: "/orgs/$slug", params: { slug: input.slug }, replace: true });
        return;
      }
      await refresh({ syncShell: mode === "member" });
    },
    onError: failure("Failed to update organization"),
  });

  const deleteOrganization = useMutation({
    mutationFn: () => adapter.deleteOrganization(orgId),
    onSuccess: async () => {
      toast.success("Organization deleted");
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      await leaveWorkspace();
    },
    onError: failure("Failed to delete organization"),
  });

  const leaveOrganization = useMutation({
    mutationFn: async () => {
      await api.leaveOrganization({ organizationId: orgId });
    },
    onSuccess: async () => {
      toast.success("You have left the organization");
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey });
      await leaveWorkspace();
    },
    onError: failure("Failed to leave organization"),
  });

  const makeActive = useMutation({
    mutationFn: async () => {
      await api.setActiveOrganization({ organizationId: orgId });
      await api.setActiveTeam({ teamId: null });
    },
    onSuccess: async () => {
      await refresh({ syncShell: true });
      toast.success("Switched organization");
    },
    onError: failure("Failed to switch organization"),
  });

  const updateMemberRole = useMutation({
    mutationFn: (input: { member: MemberRow; role: OrgRole }) =>
      adapter.updateMemberRole({ orgId, ...input }),
    onSuccess: async () => {
      toast.success("Role updated");
      await refresh();
    },
    onError: failure("Failed to update role"),
  });

  const removeMembers = useMutation({
    mutationFn: async (members: MemberRow[]) => {
      for (const member of members) await adapter.removeMember({ orgId, member });
      return members.length;
    },
    onSuccess: async (count) => {
      toast.success(count === 1 ? "Member removed" : `${count} members removed`);
      await refresh();
    },
    onError: async (error: Error) => {
      toast.error(error.message || "Failed to remove member");
      await refresh();
    },
  });

  const addMember = useMutation({
    mutationFn: (input: { userId: string; role: OrgRole }) =>
      adapter.addMember({ orgId, ...input }),
    onSuccess: async () => {
      toast.success("Member added");
      await refresh();
    },
    onError: failure("Failed to add member"),
  });

  const inviteMember = useMutation({
    mutationFn: (input: InviteInput) => adapter.inviteMember(orgId, input),
    onSuccess: async (_, input) => {
      toast.success(`Invitation created for ${input.email ?? input.nearAccountId}`);
      await refresh();
    },
    onError: failure("Failed to send invitation"),
  });

  const cancelInvitation = useMutation({
    mutationFn: (invitationId: string) => adapter.cancelInvitation(invitationId),
    onSuccess: async () => {
      toast.success("Invitation cancelled");
      await refresh();
    },
    onError: failure("Failed to cancel invitation"),
  });

  const resendInvitation = useMutation({
    mutationFn: (invitation: InvitationRow) => {
      if (invitation.nearAccountId && !invitation.nearNetwork) {
        throw new Error("Cancel and reissue this wallet invitation with an explicit network.");
      }
      return adapter.inviteMember(orgId, {
        role: (invitation.role ?? "member") as OrgRole,
        ...(invitation.nearAccountId
          ? {
              nearAccountId: invitation.nearAccountId,
              nearNetwork: invitation.nearNetwork ?? undefined,
            }
          : invitation.email
            ? { email: invitation.email }
            : {}),
        ...(invitation.teamId ? { teamId: invitation.teamId } : {}),
        resend: true,
      });
    },
    onSuccess: async () => {
      toast.success("Invitation resent");
      await refresh();
    },
    onError: failure("Failed to resend invitation"),
  });

  const createTeam = useMutation({
    mutationFn: (input: { name: string; areas: string[] }) =>
      adapter.createTeam({ orgId, ...input }),
    onSuccess: async (team) => {
      toast.success(`Team "${team.name}" created`);
      await refresh({ syncShell: true });
    },
    onError: failure("Failed to create team"),
  });

  const updateTeam = useMutation({
    mutationFn: (input: { teamId: string; name?: string; areas?: string[] }) =>
      adapter.updateTeam({ orgId, ...input }),
    onSuccess: async () => {
      await refresh({ syncShell: true });
    },
    onError: failure("Failed to update team"),
  });

  const deleteTeam = useMutation({
    mutationFn: (teamId: string) => adapter.deleteTeam({ orgId, teamId }),
    onSuccess: async () => {
      toast.success("Team deleted");
      await refresh({ syncShell: true });
    },
    onError: failure("Failed to delete team"),
  });

  const addTeamMember = useMutation({
    mutationFn: (input: { teamId: string; userId: string }) =>
      adapter.addTeamMember({ orgId, ...input }),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({
        queryKey: orgTeamMembersQueryKey(mode, input.teamId),
      });
      await refresh({ syncShell: true });
    },
    onError: failure("Failed to add team member"),
  });

  const removeTeamMember = useMutation({
    mutationFn: (input: { teamId: string; userId: string }) =>
      adapter.removeTeamMember({ orgId, ...input }),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({
        queryKey: orgTeamMembersQueryKey(mode, input.teamId),
      });
      await refresh({ syncShell: true });
    },
    onError: failure("Failed to remove team member"),
  });

  return {
    updateOrganization,
    deleteOrganization,
    leaveOrganization,
    makeActive,
    updateMemberRole,
    removeMembers,
    addMember,
    inviteMember,
    cancelInvitation,
    resendInvitation,
    createTeam,
    updateTeam,
    deleteTeam,
    addTeamMember,
    removeTeamMember,
  };
}
