import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createWorkspaceSynchronization, useAuthClient } from "everything-dev/ui/auth";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { organizationsQueryKey, orgWorkspaceQueryKey } from "@/lib/org-query-keys";
import { isManagerRole, type OrgWorkspaceAdapter, type WorkspaceSnapshot } from "./adapter";
import type { OrgInfo } from "./types";

export interface OrgWorkspaceValue {
  adapter: OrgWorkspaceAdapter;
  mode: OrgWorkspaceAdapter["mode"];
  reference: string;
  snapshot: WorkspaceSnapshot;
  org: OrgInfo;
  viewerUserId: string | undefined;
  activeOrganizationId: string | null;
  isActive: boolean;
  myRole: string | null;
  canManage: boolean;
  isOwner: boolean;
  isPersonal: boolean;
  refresh: (options?: { syncShell?: boolean }) => Promise<void>;
}

const OrgWorkspaceContext = createContext<OrgWorkspaceValue | null>(null);

export function OrgWorkspaceProvider({
  adapter,
  reference,
  snapshot,
  viewerUserId,
  activeOrganizationId,
  children,
}: {
  adapter: OrgWorkspaceAdapter;
  reference: string;
  snapshot: WorkspaceSnapshot;
  viewerUserId: string | undefined;
  activeOrganizationId: string | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const auth = useAuthClient();

  const value = useMemo<OrgWorkspaceValue>(() => {
    const isAdminMode = adapter.mode === "admin";
    const isPersonal =
      snapshot.org.slug === viewerUserId ||
      (snapshot.org.metadata as { isPersonal?: boolean } | null | undefined)?.isPersonal === true;
    const queryKey = orgWorkspaceQueryKey(adapter.mode, reference);
    return {
      adapter,
      mode: adapter.mode,
      reference,
      snapshot,
      org: snapshot.org,
      viewerUserId,
      activeOrganizationId,
      isActive: snapshot.org.id === activeOrganizationId,
      myRole: snapshot.myRole,
      canManage: isAdminMode || isManagerRole(snapshot.myRole),
      isOwner: isAdminMode || snapshot.myRole === "owner",
      isPersonal,
      refresh: async (options) => {
        if (options?.syncShell) {
          await createWorkspaceSynchronization({ auth, queryClient, router }).synchronize({
            queryKeys: [queryKey, organizationsQueryKey],
          });
          return;
        }
        await queryClient.invalidateQueries({ queryKey });
      },
    };
  }, [adapter, reference, snapshot, viewerUserId, activeOrganizationId, auth, queryClient, router]);

  return <OrgWorkspaceContext.Provider value={value}>{children}</OrgWorkspaceContext.Provider>;
}

export function useOrgWorkspace(): OrgWorkspaceValue {
  const value = useContext(OrgWorkspaceContext);
  if (!value) throw new Error("useOrgWorkspace must be used inside an organization workspace");
  return value;
}
