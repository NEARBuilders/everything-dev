import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/app";
import { resolveTeamWorkspace } from "@/lib/team-workspace";
import {
  appendPluginSidebarItems,
  buildNavItems,
  filterSidebarByArea,
  filterSidebarByRole,
  getUserRole,
  pluginNavToSidebar,
} from "./nav-items";
import { useIdentity } from "./use-identity";
import { useTeamWorkspace } from "./use-team-workspace";

export function useCanCurate(enabled: boolean) {
  const api = useApiClient();
  const studio = useQuery({
    queryKey: ["discover"],
    queryFn: () => api.getDiscoveryStudio(),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  return studio.isSuccess;
}

export function useShellNav(
  isAdmin: boolean,
  pluginNav?: { items: Parameters<typeof pluginNavToSidebar>[0] },
) {
  const { user, activeOrg } = useIdentity();
  const signedIn = Boolean(user);
  const { data: workspace = resolveTeamWorkspace(null) } = useTeamWorkspace(signedIn);
  const canCurate = useCanCurate(signedIn && !isAdmin);
  const role = getUserRole(signedIn, isAdmin);

  const builtin = buildNavItems({
    activeOrgSlug: activeOrg?.slug ?? null,
    canManageOrganization: workspace.canManageOrganization ?? false,
    canCurate,
    isAdmin,
  });
  const withPlugins = pluginNav?.items?.length
    ? appendPluginSidebarItems(builtin, pluginNavToSidebar(pluginNav.items))
    : builtin;
  return filterSidebarByArea(filterSidebarByRole(withPlugins, role), workspace.allowedAreas);
}
