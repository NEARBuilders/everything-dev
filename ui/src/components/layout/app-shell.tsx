import { Outlet, useRouterState } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";
import type { ClientRuntimeConfig, SessionData } from "@/app";
import { getAppName } from "@/app";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import type { pluginNavToSidebar } from "./nav-items";
import { useShellNav } from "./use-shell-nav";

interface AppShellProps {
  session: SessionData | null | undefined;
  runtimeConfig?: Partial<ClientRuntimeConfig>;
  isAdmin?: boolean;
  pluginNav?: { items: Parameters<typeof pluginNavToSidebar>[0] };
  children?: ReactNode;
}

const InsideAppShell = createContext(false);

export function AppShell(props: AppShellProps) {
  const nested = useContext(InsideAppShell);
  if (nested) return <>{props.children ?? <Outlet />}</>;
  return (
    <InsideAppShell.Provider value={true}>
      <AppShellFrame {...props} />
    </InsideAppShell.Provider>
  );
}

function AppShellFrame({ runtimeConfig, isAdmin = false, pluginNav, children }: AppShellProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const appName = getAppName(runtimeConfig);
  const items = useShellNav(isAdmin, pluginNav);

  return (
    <SidebarProvider className="min-h-0 flex-1">
      <AppSidebar items={items} appName={appName} pathname={pathname} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <div
          className="sticky-offset-header flex min-h-0 flex-1 flex-col overflow-y-auto"
          data-testid="app-shell-main"
        >
          <AppHeader runtimeConfig={runtimeConfig} />
          <div className="flex-1">{children ?? <Outlet />}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
