import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/app";
import { teamWorkspaceQueryOptions } from "@/lib/team-workspace";

export function useTeamWorkspace(enabled = true) {
  const apiClient = useApiClient();
  return useQuery({
    ...teamWorkspaceQueryOptions(apiClient),
    enabled,
  });
}
