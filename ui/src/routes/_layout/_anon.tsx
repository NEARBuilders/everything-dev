import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { getAppName, sessionQueryOptions } from "@/app";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/_layout/_anon")({
  beforeLoad: async ({ context }) => {
    const { queryClient, authClient } = context;
    const initialSession = context.session;
    const session =
      initialSession ??
      queryClient.getQueryData(sessionQueryOptions(authClient, initialSession).queryKey);
    if (session?.user) {
      throw redirect({ to: "/dashboard", search: {} });
    }
  },
  component: AnonLayout,
});

function AnonLayout() {
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
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className="flex-1 flex flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
