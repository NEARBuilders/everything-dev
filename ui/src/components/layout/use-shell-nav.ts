import { resolveTeamWorkspace } from "@/lib/team-workspace";
import manifestJson from "@/manifest.gen.json" with { type: "json" };
import {
  appendPluginSidebarItems,
  buildNavItems,
  filterSidebarByArea,
  filterSidebarByRole,
  filterSidebarByRoutes,
  getUserRole,
  type ManifestRoute,
  pluginNavToSidebar,
  routePathsFromManifest,
} from "./nav-items";
import { useIdentity } from "./use-identity";
import { useTeamWorkspace } from "./use-team-workspace";

const shippedRoutePaths = routePathsFromManifest(
  (manifestJson as { routes: ManifestRoute[] }).routes,
);

export function useShellNav(
  isAdmin: boolean,
  pluginNav?: { items: Parameters<typeof pluginNavToSidebar>[0] },
) {
  const { user, activeOrg } = useIdentity();
  const signedIn = Boolean(user);
  const { data: workspace = resolveTeamWorkspace(null) } = useTeamWorkspace(signedIn);
  const role = getUserRole(signedIn, isAdmin);

  const builtin = buildNavItems({
    activeOrgSlug: activeOrg?.slug ?? null,
    canManageOrganization: workspace.canManageOrganization ?? false,
    isAdmin,
  });
  const withRoutes = filterSidebarByRoutes(builtin, shippedRoutePaths);
  const withPlugins = pluginNav?.items?.length
    ? appendPluginSidebarItems(withRoutes, pluginNavToSidebar(pluginNav.items))
    : withRoutes;
  return filterSidebarByArea(filterSidebarByRole(withPlugins, role), workspace.allowedAreas);
}
