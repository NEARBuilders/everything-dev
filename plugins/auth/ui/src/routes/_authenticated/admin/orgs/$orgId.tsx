import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "everything-dev/ui/auth";
import { createAdminAdapter } from "@/components/org/adapter";
import { OrgWorkspaceLayout, orgWorkspaceQueryOptions } from "@/components/org/workspace-layout";

export const Route = createFileRoute("/_authenticated/admin/orgs/$orgId")({
  head: () => ({
    meta: [
      { title: "Organization · Admin" },
      { name: "description", content: "Platform-wide organization management." },
    ],
  }),
  beforeLoad: requireAdmin,
  loader: async ({ context, params }) => {
    const adapter = createAdminAdapter(context.apiClient.auth);
    await context.queryClient.prefetchQuery(
      orgWorkspaceQueryOptions("admin", params.orgId, () =>
        adapter.loadSnapshot(params.orgId, undefined),
      ),
    );
  },
  component: AdminWorkspace,
});

function AdminWorkspace() {
  const { orgId } = Route.useParams();
  return <OrgWorkspaceLayout mode="admin" reference={orgId} />;
}
