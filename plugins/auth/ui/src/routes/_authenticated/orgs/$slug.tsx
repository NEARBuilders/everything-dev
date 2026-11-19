import { createFileRoute } from "@tanstack/react-router";
import { sessionQueryOptions } from "everything-dev/ui/auth";
import { createMemberAdapter } from "@/components/org/adapter";
import { OrgWorkspaceLayout, orgWorkspaceQueryOptions } from "@/components/org/workspace-layout";

export const Route = createFileRoute("/_authenticated/orgs/$slug")({
  head: () => ({
    meta: [
      { title: "Organization" },
      { name: "description", content: "Members, teams and settings for an organization." },
    ],
  }),
  loader: async ({ context, params }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient),
    );
    const adapter = createMemberAdapter(context.apiClient.auth);
    await context.queryClient.prefetchQuery(
      orgWorkspaceQueryOptions("member", params.slug, () =>
        adapter.loadSnapshot(params.slug, session?.user?.id),
      ),
    );
  },
  component: MemberWorkspace,
});

function MemberWorkspace() {
  const { slug } = Route.useParams();
  return <OrgWorkspaceLayout mode="member" reference={slug} />;
}
