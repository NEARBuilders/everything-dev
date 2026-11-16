import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  createWorkspaceSynchronization,
  reportWorkspaceRefreshError,
  useAuthClient,
} from "everything-dev/ui/auth";
import { useRef } from "react";
import { toast } from "sonner";
import { organizationsQueryKey, userInvitationsQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";

export interface InvitationActionInvitation {
  id: string;
  nearAccountId?: string | null;
  organizationName?: string | null;
  organizationSlug?: string | null;
}

export function useInvitationActions({
  onAccepted,
  onRejected,
}: {
  onAccepted?: (invitation: InvitationActionInvitation) => Promise<void> | void;
  onRejected?: (invitation: InvitationActionInvitation) => Promise<void> | void;
}) {
  const api = useAuthApi();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const synchronization = createWorkspaceSynchronization({ auth, queryClient, router });
  const pendingAcceptance = useRef<InvitationActionInvitation | null>(null);
  const pendingRejection = useRef<InvitationActionInvitation | null>(null);
  const acceptKeys = [organizationsQueryKey, userInvitationsQueryKey] as const;

  const refreshAcceptance = async () => {
    await synchronization.synchronize({ queryKeys: acceptKeys });
    const invitation = pendingAcceptance.current;
    if (!invitation) return;
    await onAccepted?.(invitation);
    pendingAcceptance.current = null;
  };

  const refreshRejection = async () => {
    await queryClient.invalidateQueries(
      { queryKey: userInvitationsQueryKey, refetchType: "active" },
      { throwOnError: true },
    );
    const invitation = pendingRejection.current;
    if (!invitation) return;
    await onRejected?.(invitation);
    pendingRejection.current = null;
  };

  const reportError = (error: Error, fallback: string, retry: () => Promise<unknown>) => {
    const handled = reportWorkspaceRefreshError(error, retry, (retryError) =>
      reportError(retryError, "Failed to refresh workspace", retry),
    );
    if (!handled) toast.error(error.message || fallback);
  };

  const acceptMutation = useMutation({
    mutationFn: async (invitation: InvitationActionInvitation) => {
      if (invitation.nearAccountId) {
        await api.acceptNearInvitation({ invitationId: invitation.id });
      } else {
        await api.acceptInvitation({ invitationId: invitation.id });
      }
      return invitation;
    },
    onSuccess: async (invitation) => {
      pendingAcceptance.current = invitation;
      await refreshAcceptance();
    },
    onError: (error: Error) => reportError(error, "Failed to accept invitation", refreshAcceptance),
  });

  const rejectMutation = useMutation({
    mutationFn: async (invitation: InvitationActionInvitation) => {
      if (invitation.nearAccountId) {
        await api.rejectNearInvitation({ invitationId: invitation.id });
      } else {
        await api.rejectInvitation({ invitationId: invitation.id });
      }
      return invitation;
    },
    onSuccess: async (invitation) => {
      pendingRejection.current = invitation;
      await refreshRejection();
    },
    onError: (error: Error) => reportError(error, "Failed to decline invitation", refreshRejection),
  });

  return { acceptMutation, rejectMutation };
}
