import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";

export function LandingChrome() {
  return (
    <div style={{ border: "2px solid #4ade80", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#4ade80", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-landing
      </div>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute();

// `_public` is the mount declaration — a pathless layout the host maps to its
// `public` mount point. No `mounts` map, no `name` export. Just routes.
const publicSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_public",
  component: LandingChrome,
});

const indexRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/",
  component: () => (
    <div>
      <h1>Landing index (/)</h1>
      <p>From remote-landing · grafted under host `public` mount</p>
      <a href="/about">About</a> · <a href="/dashboard">Dashboard</a> ·{" "}
      <a href="/settings">Settings</a> · <a href="/admin/users">Admin</a>
    </div>
  ),
});

const aboutRoute = createRoute({
  getParentRoute: () => publicSubtreeRoot,
  path: "/about",
  component: () => (
    <div>
      <h1>About (/about)</h1>
      <p>From remote-landing</p>
      <a href="/">← Home</a>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  publicSubtreeRoot.addChildren([indexRoute, aboutRoute]),
]);

export default { tree };
