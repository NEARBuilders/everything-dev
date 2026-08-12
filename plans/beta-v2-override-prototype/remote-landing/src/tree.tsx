import { createRootRoute, createRoute, Outlet, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";

interface DashboardApi {
  getStats: () => Promise<{ users: number; projects: number }>;
}

interface HostContext {
  apiClient?: { dashboard?: DashboardApi };
}

function LandingChrome() {
  return (
    <div style={{ border: "2px solid #4ade80", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-landing · UI-only plugin
      </div>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute();

const publicSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_public",
  component: LandingChrome,
});

function HomePage() {
  const { apiClient } = useRouteContext({ strict: false }) as HostContext;
  const [users, setUsers] = useState<number | null>(null);
  const apiOk = apiClient?.dashboard?.getStats ? "apiClient:ok" : "apiClient:missing";

  useEffect(() => {
    apiClient?.dashboard?.getStats().then((s) => setUsers(s.users));
  }, [apiClient]);

  return (
    <div data-testid="landing-home">
      <h1>Landing index (/)</h1>
      <p>UI-only plugin · from remote-landing.</p>
      <p>
        Cross-plugin access: dashboard API reports <strong>{users === null ? "…" : `${users} users`}</strong>
      </p>
      <span data-testid="api-client-status" style={{ display: "none" }}>
        {apiOk}
      </span>
    </div>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/",
  component: HomePage,
});

const aboutRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/about",
  component: () => (
    <div>
      <h1>About (/about)</h1>
      <p>From remote-landing.</p>
      <a href="/">← Home</a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  publicSubtreeRoot.addChildren([indexRoute, aboutRoute]),
]);

export default { tree };
