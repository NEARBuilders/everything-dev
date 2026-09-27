import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import {
  createWorkspaceSynchronization,
  reportWorkspaceRefreshError,
} from "@/lib/workspace-synchronization";

export function useSwitchTeam() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const synchronization = createWorkspaceSynchronization({ auth, queryClient, router });
  const reportError = (error: Error) => {
    if (reportWorkspaceRefreshError(error, synchronization.synchronize, reportError)) return;
    toast.error(error.message || "Failed to switch team");
  };

  const mutation = useMutation({
    mutationFn: async (teamId: string | null) => {
      const { error } = await auth.organization.setActiveTeam({ teamId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async (_, teamId) => {
      await synchronization.synchronize();
      toast.success(teamId ? "Switched team workspace" : "Showing all areas");
    },
    onError: reportError,
  });

  return {
    ...mutation,
    refreshWorkspace: synchronization.synchronize,
  };
}
