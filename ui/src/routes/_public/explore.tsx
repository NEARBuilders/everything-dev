import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useApiClient } from "@/app";
import { DiscoveryExplorer } from "@/components/discovery/discovery-explorer";
import { PageContainer } from "@/components/layout/page-container";
import { pageTitle } from "@/lib/page-title";
export const Route = createFileRoute("/_public/explore")({
  validateSearch: z.object({
    campaign: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_-]*$/)
      .optional()
      .catch(undefined),
    active: z.boolean().optional().catch(undefined),
    upcoming: z.boolean().optional().catch(undefined),
    node: z.uuid().optional().catch(undefined),
    query: z.string().max(120).optional().catch(undefined),
    region: z.string().max(120).optional().catch(undefined),
    view: z.enum(["list", "map"]).optional().catch(undefined),
  }),
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Explore", match.context.runtimeConfig) },
      {
        name: "description",
        content: "Find a CityNode community near you and see what's coming up.",
      },
    ],
  }),
  component: Explore,
});
function Explore() {
  const api = useApiClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageContainer variant="wide">
      <DiscoveryExplorer
        api={api}
        search={search}
        navigate={(next) => navigate({ search: next })}
      />
    </PageContainer>
  );
}
