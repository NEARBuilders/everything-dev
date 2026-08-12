import { createRootRoute, createRoute, Outlet, useParams } from "@tanstack/react-router";

export function OrgChrome() {
  return (
    <div style={{ border: "2px solid #34d399", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#059669", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-org
      </div>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute();

const orgSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_organization",
  component: OrgChrome,
});

function useOrgSlug() {
  const params = useParams({ strict: false }) as { orgSlug?: string };
  return params.orgSlug ?? "?";
}

const dashboardRoute = createRoute({
  getParentRoute: () => orgSubtreeRoot,
  path: "dashboard",
  component: () => (
    <div>
      <h1>Org Dashboard (/organization/{useOrgSlug()}/dashboard)</h1>
      <p>From remote-org · grafted under host `organization` mount · org: {useOrgSlug()}</p>
      <a href={`/organization/${useOrgSlug()}/settings`}>→ Org Settings</a>
    </div>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => orgSubtreeRoot,
  path: "settings",
  component: () => (
    <div>
      <h1>Org Settings (/organization/{useOrgSlug()}/settings)</h1>
      <p>From remote-org · grafted under host `organization` mount · org: {useOrgSlug()}</p>
      <a href={`/organization/${useOrgSlug()}/dashboard`}>← Org Dashboard</a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  orgSubtreeRoot.addChildren([dashboardRoute, settingsRoute]),
]);

export default { tree };
