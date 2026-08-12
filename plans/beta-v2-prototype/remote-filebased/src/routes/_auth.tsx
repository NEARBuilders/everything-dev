import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth")({
  component: () => (
    <div style={{ border: "2px solid #f472b6", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#f472b6", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-filebased
      </div>
      <Outlet />
    </div>
  ),
});