import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { getAppName } from "@/app";
import { NearBranding } from "@/components/near-branding";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserNav } from "@/components/user-nav";

export const Route = createFileRoute("/_layout/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  const { runtimeConfig } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="shrink-0 bg-card/50 border-b border-border transition-all duration-200 overflow-hidden h-12">
        <div className="flex items-center justify-between px-4 sm:px-6 h-12">
          <Link
            to="/"
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

          <div className="flex items-center gap-2">
            <ThemeToggle className="flex items-center justify-center w-8 h-8 rounded-full bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm" />
            <UserNav />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className="flex-1 flex flex-col">
          <Outlet />
        </div>
        <footer className="shrink-0 flex items-center justify-center py-6">
          <NearBranding />
        </footer>
      </div>
    </div>
  );
}
