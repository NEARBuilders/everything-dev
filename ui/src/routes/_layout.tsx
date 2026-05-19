import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { getAccount, getActiveRuntime, getAppName, sessionQueryOptions } from "@/app";
import { StyleChrome } from "@/components/style-chrome";
import { useClientValue } from "@/hooks/use-client";
import { pluginSidebarItems, type SidebarItem, type SidebarRole } from "@/lib/plugin-sidebar.gen";

function filterSidebarByRole(items: SidebarItem[], userRole: SidebarRole): SidebarItem[] {
  return items.filter((item) => {
    if (item.roleRequired === "anon") return true;
    if (item.roleRequired === "member" && userRole !== "anon") return true;
    if (item.roleRequired === "admin" && userRole === "admin") return true;
    return false;
  });
}

function getUserRole(isAuthenticated: boolean, isAdmin: boolean): SidebarRole {
  if (isAdmin) return "admin";
  if (isAuthenticated) return "member";
  return "anon";
}

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    return {
      assetsUrl: context.assetsUrl || "",
      runtimeConfig: context.runtimeConfig,
      session,
    };
  },
  component: Layout,
});

function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });
  const appName = useClientValue(() => getAppName(), "app");
  const runtime = useClientValue(() => getActiveRuntime(), undefined);
  const account = useClientValue(() => getAccount(), "every.near");
  const { session } = Route.useRouteContext();
  const isAuthenticated = !!session?.user;
  const userRole = getUserRole(isAuthenticated, session?.user?.role === "admin");
  const visibleItems = filterSidebarByRole(pluginSidebarItems, userRole);

  return (
    <StyleChrome
      appName={appName}
      pathname={pathname}
      isAuthenticated={isAuthenticated}
      isNavigating={isNavigating}
      visibleItems={visibleItems}
      account={account}
      runtime={runtime}
    >
      <div className="h-full animate-fade-in-up">
        <Outlet />
      </div>
    </StyleChrome>
  );
}
