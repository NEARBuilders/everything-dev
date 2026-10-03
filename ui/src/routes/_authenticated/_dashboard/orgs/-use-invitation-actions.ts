import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { toast } from "sonner";
import type { ApiClient, AuthClient } from "@/app";
import {
  createWorkspaceSynchronization,
  reportWorkspaceRefreshError,
  WorkspaceRefreshError,
} from "@/lib/workspace-synchronization";

export interface InvitationActionInvitation {
  id: string;
  nearAccountId?: string | null;
  organizationName?: string | null;
  organizationSlug?: string | null;
}

export function useInvitationActions({
  apiClient,
  auth,
  onAccepted,
  onRejected,
}: {
  apiClient: ApiClient;
  auth: AuthClient;
  onAccepted?: (invitation: InvitationActionInvitation) => Promise<void> | void;
  onRejected?: (invitation: InvitationActionInvitation) => Promise<void> | void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const synchronization = createWorkspaceSynchronization({ auth, queryClient, router });
  const lastRefreshKeys = useRef<readonly (readonly unknown[])[]>([]);
  const pendingAcceptance = useRef<InvitationActionInvitation | null>(null);
  const pendingRejection = useRef<InvitationActionInvitation | null>(null);

  const refreshWorkspace = async () => {
    await synchronization.synchronize({ queryKeys: lastRefreshKeys.current });
    const invitation = pendingAcceptance.current;
    if (!invitation) return;
    await onAccepted?.(invitation);
    pendingAcceptance.current = null;
  };

  const refreshRejection = async () => {
    try {
      await queryClient.invalidateQueries(
        { queryKey: ["user-invitations"], refetchType: "active" },
        { throwOnError: true },
      );
    } catch (error) {
      throw new WorkspaceRefreshError("management", error);
    }
    const invitation = pendingRejection.current;
    if (!invitation) return;
    await onRejected?.(invitation);
    pendingRejection.current = null;
  };

  const reportError = (
    error: Error,
    fallback: string,
    retry: () => Promise<unknown> = refreshWorkspace,
  ) => {
    if (
      reportWorkspaceRefreshError(error, retry, (retryError) =>
        reportError(retryError, "Failed to refresh workspace", retry),
      )
    ) {
      return;
    }
    toast.error(error.message || fallback);
  };

  const acceptMutation = useMutation({
    mutationFn: async (invitation: InvitationActionInvitation) => {
      if (invitation.nearAccountId) {
        await apiClient.auth.acceptNearInvitation({ invitationId: invitation.id });
      } else {
        await apiClient.auth.acceptInvitation({ invitationId: invitation.id });
      }
      return invitation;
    },
    onSuccess: async (invitation) => {
      pendingAcceptance.current = invitation;
      lastRefreshKeys.current = [["organizations"], ["user-invitations"]];
      await synchronization.synchronize({ queryKeys: lastRefreshKeys.current });
      await onAccepted?.(invitation);
      pendingAcceptance.current = null;
    },
    onError: (error: Error) => reportError(error, "Failed to accept invitation"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (invitation: InvitationActionInvitation) => {
      if (invitation.nearAccountId) {
        await apiClient.auth.rejectNearInvitation({ invitationId: invitation.id });
      } else {
        await apiClient.auth.rejectInvitation({ invitationId: invitation.id });
      }
      return invitation;
    },
    onSuccess: async (invitation) => {
      pendingRejection.current = invitation;
      await refreshRejection();
    },
    onError: (error: Error) => reportError(error, "Failed to decline invitation", refreshRejection),
  });

  return { acceptMutation, rejectMutation, refreshWorkspace };
}
