import {
  type QueryKey,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import {
  createWorkspaceSynchronization,
  reportWorkspaceRefreshError,
} from "@/lib/workspace-synchronization";
import { orgTeamMembersQueryKey, orgTeamsQueryKey } from "./-organization-query-keys";
import type { TeamMembershipStatus, TeamsTabTeam } from "./-teams-tab";

export function useOrganizationTeams(orgId: string, membershipsEnabled = false) {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const synchronization = createWorkspaceSynchronization({ auth, queryClient, router });
  const lastRefreshKeys = useRef<readonly QueryKey[]>([]);
  const teamsQuery = useQuery({
    queryKey: orgTeamsQueryKey(orgId),
    queryFn: () => apiClient.auth.listTeams({ organizationId: orgId }),
    enabled: !!orgId,
  });
  const teamList = teamsQuery.data ?? [];
  const memberQueries = useQueries({
    queries: teamList.map((team) => ({
      queryKey: orgTeamMembersQueryKey(team.id),
      queryFn: () => apiClient.auth.listTeamMembers({ teamId: team.id }),
      enabled: membershipsEnabled,
      staleTime: 30 * 1000,
    })),
  });
  const teams: TeamsTabTeam[] = teamList.map((team, index) => ({
    id: team.id,
    name: team.name,
    areas: team.areas,
    memberUserIds: (memberQueries[index]?.data ?? []).map((member) => member.userId),
    memberStatus: resolveMembershipStatus(membershipsEnabled, memberQueries[index]),
    memberError:
      memberQueries[index]?.error instanceof Error ? memberQueries[index].error.message : undefined,
  }));

  const synchronizeAfterMutation = (queryKeys: readonly QueryKey[]) => {
    lastRefreshKeys.current = queryKeys;
    return synchronization.synchronize({ queryKeys });
  };
  const refreshWorkspace = () =>
    synchronization.synchronize({ queryKeys: lastRefreshKeys.current });
  const onError = (fallback: string) => (error: Error) => {
    if (reportWorkspaceRefreshError(error, refreshWorkspace, onError(fallback))) {
      return;
    }
    toast.error(error.message || fallback);
  };

  const createTeam = useMutation({
    mutationFn: (name: string) => apiClient.auth.createTeam({ name, organizationId: orgId }),
    onSuccess: async (team) => {
      await synchronizeAfterMutation([orgTeamsQueryKey(orgId)]);
      toast.success(`Team "${team.name}" created`);
    },
    onError: onError("Failed to create team"),
  });
  const updateTeam = useMutation({
    mutationFn: (input: { teamId: string; name?: string; areas?: string[] }) =>
      apiClient.auth.updateTeam({
        teamId: input.teamId,
        organizationId: orgId,
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.areas !== undefined ? { areas: input.areas } : {}),
        },
      }),
    onSuccess: () => synchronizeAfterMutation([orgTeamsQueryKey(orgId)]),
    onError: onError("Failed to update team"),
  });
  const deleteTeam = useMutation({
    mutationFn: (teamId: string) => apiClient.auth.deleteTeam({ teamId, organizationId: orgId }),
    onSuccess: async () => {
      await synchronizeAfterMutation([orgTeamsQueryKey(orgId)]);
      toast.success("Team deleted");
    },
    onError: onError("Failed to delete team"),
  });
  const addTeamMember = useMutation({
    mutationFn: (input: { teamId: string; userId: string }) =>
      apiClient.auth.addTeamMember({ ...input, organizationId: orgId }),
    onSuccess: (_, input) => synchronizeAfterMutation([orgTeamMembersQueryKey(input.teamId)]),
    onError: onError("Failed to add team member"),
  });
  const removeTeamMember = useMutation({
    mutationFn: (input: { teamId: string; userId: string }) =>
      apiClient.auth.removeTeamMember({ ...input, organizationId: orgId }),
    onSuccess: (_, input) => synchronizeAfterMutation([orgTeamMembersQueryKey(input.teamId)]),
    onError: onError("Failed to remove team member"),
  });

  return {
    teams,
    isMutating:
      createTeam.isPending ||
      updateTeam.isPending ||
      deleteTeam.isPending ||
      addTeamMember.isPending ||
      removeTeamMember.isPending,
    createTeam,
    updateTeam,
    deleteTeam,
    addTeamMember,
    removeTeamMember,
    membershipsEnabled,
    refreshWorkspace,
    retryTeamMembers: (teamId: string) =>
      queryClient.refetchQueries(
        { queryKey: orgTeamMembersQueryKey(teamId), type: "active" },
        { throwOnError: true },
      ),
  };
}

function resolveMembershipStatus(
  membershipsEnabled: boolean,
  query: { data: unknown; isError: boolean } | undefined,
): TeamMembershipStatus {
  if (!membershipsEnabled) return "unloaded";
  if (query?.isError) return "error";
  if (query?.data) return "success";
  return "loading";
}
