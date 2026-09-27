import { createFileRoute } from "@tanstack/react-router";
import { getActiveRuntime } from "@/app";
import { PageContainer, PageHeader, UnderConstruction } from "@/components";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_public/launch")({
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Launch a node", match.context.runtimeConfig) },
      { name: "description", content: "Launch your own node on the everything.dev runtime." },
    ],
  }),
  component: LaunchPage,
});

function LaunchPage() {
  const { runtimeConfig } = Route.useRouteContext();
  const activeRuntime = getActiveRuntime(runtimeConfig);

  return (
    <PageContainer variant="narrow" className="items-center gap-8 py-12">
      <PageHeader
        headerTestId="launch.heading"
        title="Launch a node"
        description={`Run your own node on ${activeRuntime?.title ?? "everything.dev"} — composed from published config, live in minutes.`}
      />
      <UnderConstruction className="max-w-sm" sourceFile="ui/src/routes/_public/launch.tsx" />
    </PageContainer>
  );
}
