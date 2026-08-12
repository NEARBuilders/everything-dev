import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_public")({
  component: () => (
    <div style={{ border: "2px solid #22d3ee", padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: "#22d3ee", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        remote-filebased
      </div>
      <Outlet />
    </div>
  ),
});