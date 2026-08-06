import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ClipboardList, Compass, Globe, Home, Menu, Shield, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAccount,
  getActiveRuntime,
  getAppName,
  sessionQueryOptions,
  useAuthClient,
} from "@/app";
import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserNav } from "@/components/user-nav";
import { cn } from "@/lib/utils";

interface TenantContext {
  id: string;
  subdomain: string;
  accountId: string;
  orgId: string;
  name: string;
  createdAt: string;
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

export const Route = createFileRoute("/_layout")({
  beforeLoad: async ({ context }) => {
    const { queryClient, authClient, apiClient } = context;
    const session = await queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );

    const accountId = getAccount(context.runtimeConfig);
    let tenant: TenantContext | null = null;
    try {
      tenant = await apiClient.resolveTenant({ accountId });
    } catch {
      tenant = null;
    }

    return {
      runtimeConfig: context.runtimeConfig,
      session,
      tenant,
    };
  },
  component: Layout,
});

function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isNavigating = useRouterState({ select: (s) => s.status === "pending" });
  const { runtimeConfig, session, tenant } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);
  const runtime = getActiveRuntime(runtimeConfig);
  const account = getAccount(runtimeConfig);
  const auth = useAuthClient();
  const isAuthenticated = !!session?.user;
  const userRole = getUserRole(isAuthenticated, session?.user?.role === "admin");

  const { data: liveSession } = useQuery({
    ...sessionQueryOptions(auth, session),
    initialData: session,
  });
  const activeOrgId = liveSession?.session?.activeOrganizationId ?? null;
  const liveIsTenantMember = !!tenant && !!activeOrgId && activeOrgId === tenant.orgId;

  const hideSidebar = pathname === "/login";

  const sidebarItems: SidebarItem[] = [
    { icon: Home, label: "home", to: "/home", roleRequired: "anon" },
    { icon: Globe, label: "apps", to: "/apps", roleRequired: "anon" },
    ...(liveIsTenantMember
      ? ([{ icon: Shield, label: "admin", to: "/admin", roleRequired: "member" }] as SidebarItem[])
      : []),
  ];
  const visibleItems = filterSidebarByRole(sidebarItems, userRole);

  const isActive = (item: SidebarItem) => {
    return pathname === item.to || (item.to !== "/" && pathname.startsWith(`${item.to}/`));
  };

  const [betaBannerDismissed, setBetaBannerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("beta-banner-dismissed") === "true";
  });

  useEffect(() => {
    localStorage.setItem("beta-banner-dismissed", String(betaBannerDismissed));
  }, [betaBannerDismissed]);

  return (
    <TooltipProvider>
      <div
        className="h-dvh w-full flex flex-col overflow-hidden bg-background text-foreground"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {!betaBannerDismissed && (
          <div className="shrink-0 flex items-center justify-center py-1.5 pl-3 pr-1 bg-yellow-300 border-b border-yellow-400">
            <span className="flex-1 text-[11px] font-bold tracking-wide text-yellow-950 text-center">
              Beta database will be wiped periodically. Do not save data you want to keep.
            </span>
            <button
              type="button"
              onClick={() => setBetaBannerDismissed(true)}
              className="shrink-0 p-1 text-yellow-950/60 hover:text-yellow-950 transition-colors cursor-pointer"
              aria-label="Dismiss beta banner"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {isNavigating && (
          <div className="fixed top-0 left-0 right-0 h-[2px] z-50 overflow-hidden pointer-events-none">
            <div className="h-full bg-foreground animate-progress-bar" style={{ width: "100%" }} />
          </div>
        )}

        <header
          className={cn(
            "shrink-0 bg-card/50 border-b border-border transition-all duration-200 overflow-hidden",
            hideSidebar ? "h-0 opacity-0 border-b-0" : "h-12 opacity-100",
          )}
        >
          <div className="flex items-center justify-between px-4 sm:px-6 h-12">
            {isAuthenticated ? (
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
                  {tenant && (
                    <>
                      <span>{tenant.name}</span>
                      <span>/</span>
                    </>
                  )}
                  <span>{runtime?.accountId ?? account}</span>
                  <span>/</span>
                  <span className="truncate">
                    {pathname === "/" ? "home" : pathname.slice(1).split("/").join(" / ")}
                  </span>
                </div>
              </div>
            ) : (
              <Link
                to="/login"
                aria-label={`${appName} home`}
                className="flex items-center justify-center w-10 h-10 transition-opacity duration-200 hover:opacity-70"
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
            )}

            <div className="flex items-center gap-2">
              <UserNav />
            </div>
          </div>
        </header>
        {hideSidebar && <MinimalHeader />}

        <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          <aside
            className={cn(
              "hidden sm:flex h-full shrink-0 flex-col items-center border-r border-border bg-card overflow-hidden transition-all duration-300",
              isAuthenticated && !hideSidebar ? "w-16 opacity-100" : "w-0 opacity-0 border-r-0",
            )}
          >
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
                  active
                    ? "bg-foreground text-background"
                    : "bg-card text-foreground hover:bg-muted",
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
            <main className="flex-1 w-full min-h-0 overflow-y-auto pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
              <Outlet />
            </main>
          </div>
        </div>

        <footer
          className={cn(
            "shrink-0 justify-center py-6 hidden sm:flex transition-opacity duration-300",
            hideSidebar ? "opacity-0 pointer-events-none" : "opacity-100",
          )}
        >
          <NearBranding />
        </footer>

        {!isAuthenticated && !hideSidebar && (
          <div className="fixed bottom-4 left-4 z-40">
            <ThemeToggle className="relative flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm" />
          </div>
        )}

        <div
          className={cn(
            "transition-opacity duration-300",
            hideSidebar ? "opacity-0 pointer-events-none" : "opacity-100",
          )}
        >
          <MobileTabBar
            isAuthenticated={isAuthenticated}
            visibleItems={visibleItems}
            isActive={isActive}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function MinimalHeader() {
  return (
    <div className="fixed bottom-4 left-4 z-40">
      <ThemeToggle className="relative flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm" />
    </div>
  );
}

function NearBranding() {
  return (
    <a
      href="https://near.dev"
      target="_blank"
      rel="noopener noreferrer"
      className="relative block h-5 w-[84px] mx-auto"
    >
      <img
        src={builtOn}
        alt="Built on NEAR"
        className="absolute inset-0 h-full w-full object-contain dark:hidden"
      />
      <img
        src={builtOnRev}
        alt="Built on NEAR"
        className="absolute inset-0 hidden h-full w-full object-contain dark:block"
      />
    </a>
  );
}

function MobileTabBar({
  isAuthenticated,
  visibleItems,
  isActive,
}: {
  isAuthenticated: boolean;
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
        <TabItem to="/home" icon={Home} label="home" active={tabActive("/home")} />
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
              {isAuthenticated && (
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
              )}
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
