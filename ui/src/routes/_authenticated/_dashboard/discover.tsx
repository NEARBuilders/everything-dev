import { createFileRoute } from "@tanstack/react-router";
import { Discover } from "@/components/discovery/discover";
import { PageContainer } from "@/components/layout/page-container";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_authenticated/_dashboard/discover")({
  head: ({ match }) => ({ meta: [{ title: pageTitle("Directory", match.context.runtimeConfig) }] }),
  component: CuratePage,
});

function CuratePage() {
  return (
    <PageContainer variant="wide">
      <Discover />
    </PageContainer>
  );
}
