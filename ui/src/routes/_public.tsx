import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { sessionQueryOptions, useAuthClient } from "@/app";
import { AppShell } from "@/components/layout/app-shell";
import { PublicShell, PublicShellFooter } from "@/components/layout/public-shell";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

const FOCUSED_PREFIXES = ["/login", "/onboard"];

export function isFocusedPublicPath(pathname: string) {
  return FOCUSED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function PublicLayout() {
  const { runtimeConfig, session: contextSession, pluginNav } = Route.useRouteContext();
  const auth = useAuthClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session = contextSession } = useQuery(sessionQueryOptions(auth));
  const focused = isFocusedPublicPath(pathname);

  if (session?.user && !focused) {
    return (
      <AppShell
        runtimeConfig={runtimeConfig}
        session={session}
        isAdmin={session.user.role === "admin"}
        pluginNav={pluginNav}
      />
    );
  }

  return (
    <PublicShell
      focused={focused}
      showSignIn={!pathname.startsWith("/login")}
      footer={focused ? undefined : <PublicShellFooter />}
    >
      <Outlet />
    </PublicShell>
  );
}
