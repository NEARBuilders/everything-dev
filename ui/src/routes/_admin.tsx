import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { requireSession } from "@/app";

export const Route = createFileRoute("/_admin")({
  beforeLoad: async (args) => {
    const result = await requireSession(args);
    if (result.session.user?.role !== "admin") {
      throw redirect({ to: "/dashboard", search: { restricted: "admin" } });
    }
    return result;
  },
  component: AdminGate,
});

function AdminGate() {
  return <Outlet />;
}
