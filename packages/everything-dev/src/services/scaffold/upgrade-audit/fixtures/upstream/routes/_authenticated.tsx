import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { requireSession } from "@/app";
import { AppShell } from "@/components/layout/app-shell";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: requireSession,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { runtimeConfig, session, pluginNav } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname.startsWith("/onboarding/")) return <Outlet />;

  return (
    <AppShell
      runtimeConfig={runtimeConfig}
      session={session}
      isAdmin={session?.user?.role === "admin"}
      pluginNav={pluginNav}
    />
  );
}
