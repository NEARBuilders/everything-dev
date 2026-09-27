import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageContainer } from "@/components";
import { EventOnboardingPanel } from "@/components/discovery/event-onboarding";
import { ProfileEditor } from "@/components/discovery/profile-editor";
import { pageTitle } from "@/lib/page-title";
import { CommunityHeader, ensureCommunityHeaderData } from "../../dashboard/node/-community-header";

type ContentTab = "events" | "profile" | "onboarding";

const TABS: readonly ContentTab[] = ["events", "profile", "onboarding"];

export const Route = createFileRoute("/_authenticated/_dashboard/nodes/$nodeId/content")({
  validateSearch: (search: Record<string, unknown>): { tab?: ContentTab } =>
    TABS.includes(search.tab as ContentTab) ? { tab: search.tab as ContentTab } : {},
  loader: ({ context, params }) => ensureCommunityHeaderData(context, params.nodeId),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Events & profile", match.context.runtimeConfig) }],
  }),
  component: CommunityContent,
});

function CommunityContent() {
  const { nodeId } = Route.useParams();
  const { tab = "events" } = Route.useSearch();
  const { auth } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const selectTab = (next: ContentTab) =>
    navigate({ search: { tab: next }, replace: true, resetScroll: false });

  return (
    <PageContainer variant="wide">
      <CommunityHeader
        headerTestId="content.heading"
        nodeId={nodeId}
        active={tab === "onboarding" ? "onboarding" : "content"}
        replace
        testIds={{ onboarding: "content-tab-onboarding" }}
      />
      {tab === "onboarding" ? (
        <EventOnboardingPanel nodeId={nodeId} organizationId={auth.activeOrganizationId} />
      ) : (
        <ProfileEditor nodeId={nodeId} tab={tab} onTabChange={selectTab} />
      )}
    </PageContainer>
  );
}
