import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { ClipboardList, Compass, Globe, Home, Menu, Shield } from "lucide-react";
import { useState } from "react";
import type { SessionData } from "@/app";
import { getAccount, getActiveRuntime, getAppName, sessionQueryOptions } from "@/app";
import { NearBranding } from "@/components/near-branding";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserNav } from "@/components/user-nav";
import { cn } from "@/lib/utils";

interface AuthContext {
  isAuthenticated: boolean;
  user: SessionData["user"] | null;
  session: SessionData["session"] | null;
  activeOrganizationId: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  isBanned: boolean;
}

type SidebarRole = "anon" | "member" | "admin";

interface SidebarItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  to: string;
  roleRequired: SidebarRole;
}

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

export const Route = createFileRoute("/_layout/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    const { queryClient, authClient } = context;

    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    if (!session?.user) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    if (session.user.banned) {
      throw redirect({
        to: "/login",
        hash: "banned",
      });
    }

    const auth: AuthContext = {
      isAuthenticated: true,
      user: session.user,
      session: session.session,
      activeOrganizationId: session.session?.activeOrganizationId || null,
      isAnonymous: session.user.isAnonymous || false,
      isAdmin: session.user.role === "admin",
      isBanned: session.user.banned || false,
    };
    return {
      auth,
      session,
    };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { runtimeConfig, session } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);
  const runtime = getActiveRuntime(runtimeConfig);
  const account = getAccount(runtimeConfig);
  const isAdmin = session?.user?.role === "admin";

  const sidebarItems: SidebarItem[] = [
    { icon: Home, label: "dashboard", to: "/dashboard", roleRequired: "anon" },
    { icon: Shield, label: "admin", to: "/admin", roleRequired: "admin" },
  ];
  const visibleItems = filterSidebarByRole(sidebarItems, getUserRole(true, isAdmin));

  const isActive = (item: SidebarItem) => {
    return pathname === item.to || (item.to !== "/" && pathname.startsWith(`${item.to}/`));
  };

  return (
    <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
      <aside className="hidden sm:flex h-full shrink-0 flex-col items-center border-r border-border bg-card overflow-hidden transition-all duration-300 w-16">
        <div className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-1.5 py-4 min-h-0 min-w-16">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/"
                preload="intent"
                aria-label={`${appName} home`}
                className="mb-3 flex items-center justify-center w-10 h-10 border-2 border-outset border-border-strong bg-card shadow-sm transition-shadow duration-200 hover:shadow-md"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5 text-foreground"
                  aria-label={`${appName} logo`}
                >
                  <title>{appName}</title>
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{appName}</TooltipContent>
          </Tooltip>

          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
            const linkClass = cn(
              "flex items-center justify-center w-10 h-10 border-2 border-outset border-border-strong shadow-sm transition-all duration-200 ease-out hover:shadow-md",
              active ? "bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
            );

            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Link to={item.to} preload="intent" className={linkClass}>
                    <Icon className="w-4 h-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="shrink-0 w-full flex justify-center py-3 bg-card border-t border-border z-10">
          <ThemeToggle className="transition-colors duration-300 hover:opacity-80" />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="shrink-0 bg-card/50 border-b border-border transition-all duration-200 overflow-hidden h-12">
          <div className="flex items-center justify-between px-4 sm:px-6 h-12">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono min-w-0">
              <Link
                aria-label={`${appName} home`}
                className="sm:hidden flex items-center justify-center w-8 h-8 border-2 border-outset border-border-strong bg-card shadow-sm transition-shadow duration-200 hover:shadow-md"
                to="/"
                preload="intent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-4 h-4 text-foreground"
                  aria-label={`${appName} logo`}
                >
                  <title>{appName}</title>
                  <circle cx="12" cy="12" r="10" />
                </svg>
              </Link>

              <div className="hidden sm:flex items-center gap-2">
                <span>{runtime?.accountId ?? account}</span>
                <span>/</span>
                <span className="truncate">
                  {pathname === "/" ? "home" : pathname.slice(1).split("/").join(" / ")}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full min-h-0 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
          <div className="min-h-full">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileTabBar visibleItems={visibleItems} isActive={isActive} />
    </div>
  );
}

function MobileTabBar({
  visibleItems,
  isActive,
}: {
  visibleItems: SidebarItem[];
  isActive: (item: SidebarItem) => boolean;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 sm:hidden border-t border-border bg-card z-40"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center justify-around px-2 py-1">
        <TabItem to="/dashboard" icon={Home} label="dashboard" active={tabActive("/dashboard")} />
        <TabItem to="/apps" icon={Globe} label="apps" active={tabActive("/apps")} />
        <TabItem to="/explore" icon={Compass} label="explore" active={tabActive("/explore")} />
        <TabItem to="/recent" icon={ClipboardList} label="recent" active={tabActive("/recent")} />
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-0.5 p-2 text-muted-foreground hover:text-foreground transition-colors min-w-[48px]"
            >
              <Menu className="w-5 h-5" />
              <span className="text-[10px]">menu</span>
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="!max-w-[300px] p-0 flex flex-col">
            <SheetHeader className="!px-4 !pt-4 !pb-2 shrink-0">
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-4 py-2 space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.label}
                      to={item.to}
                      preload="intent"
                      onClick={() => setDrawerOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm font-medium transition-colors",
                        active
                          ? "bg-foreground/10 text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="shrink-0 px-4 pt-2 pb-0.5 flex justify-center">
              <NearBranding />
            </div>
            <div className="shrink-0 px-4 pb-3 pt-2 border-t border-border">
              <ThemeToggle className="relative flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground transition-colors" />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

function TabItem({
  to,
  icon: Icon,
  label,
  active,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      preload="intent"
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 p-2 min-w-[56px] rounded-[10px] transition-colors duration-200",
        active ? "text-foreground bg-foreground/10" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );
}
