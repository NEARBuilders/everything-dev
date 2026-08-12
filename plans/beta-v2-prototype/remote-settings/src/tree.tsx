import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";

export function SettingsChrome() {
  return (
    <div style={{ border: "2px solid #a78bfa", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-settings
      </div>
      <Outlet />
    </div>
  );
}

export function AdminChrome() {
  return (
    <div style={{ border: "2px solid #fb7185", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#fb7185", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-settings · admin chrome
      </div>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute();

const authSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_auth",
  component: SettingsChrome,
});

const settingsRoute = createRoute({
  getParentRoute: () => authSubtreeRoot,
  path: "/settings",
  component: () => (
    <div>
      <h1>Settings (/settings)</h1>
      <p>From remote-settings · grafted under host `auth` mount</p>
      <a href="/settings/profile">→ Profile</a>
    </div>
  ),
});

const profileRoute = createRoute({
  getParentRoute: () => authSubtreeRoot,
  path: "/settings/profile",
  component: () => (
    <div>
      <h1>Profile (/settings/profile)</h1>
      <p>From remote-settings · grafted under host `auth` mount</p>
      <a href="/settings">← Settings</a>
    </div>
  ),
});

const adminSubtreeRoot = createRoute({
  getParentRoute: () => rootRoute,
  id: "_admin",
  component: AdminChrome,
});

const adminUsersRoute = createRoute({
  getParentRoute: () => adminSubtreeRoot,
  path: "/admin/users",
  component: () => (
    <div>
      <h1>Admin Users (/admin/users)</h1>
      <p>From remote-settings · grafted under host `admin` mount</p>
    </div>
  ),
});

export const tree = rootRoute.addChildren([
  authSubtreeRoot.addChildren([settingsRoute, profileRoute]),
  adminSubtreeRoot.addChildren([adminUsersRoute]),
]);

export default { tree };