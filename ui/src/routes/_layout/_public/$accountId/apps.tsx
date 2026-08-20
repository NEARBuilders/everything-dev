import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useApiClient } from "@/app";
import { Badge } from "@/components";

export const Route = createFileRoute("/_layout/_public/$accountId/apps")({
  loader: async ({ params, context }) => {
    const { queryClient, apiClient } = context;
    const accountId = params.accountId;
    await queryClient.prefetchQuery({
      queryKey: ["apps-account", accountId],
      queryFn: () => apiClient.apps.getRegistryAppsByAccount({ accountId }),
      staleTime: 30_000,
    });
    return { accountId };
  },
  head: ({ params }) => ({
    meta: [
      { title: `${params.accountId} | Apps | everything.dev` },
      {
        name: "description",
        content: `Browse published gateways for ${params.accountId} on everything.dev.`,
      },
    ],
  }),
  component: AccountAppsTab,
});

function AccountAppsTab() {
  const { accountId } = Route.useParams();
  const apiClient = useApiClient();

  const { data: appsData } = useSuspenseQuery({
    queryKey: ["apps-account", accountId],
    queryFn: () => apiClient.apps.getRegistryAppsByAccount({ accountId }),
    staleTime: 30_000,
  });

  const apps = appsData?.data ?? [];

  if (apps.length === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        No published gateways for <span className="font-mono text-foreground">{accountId}</span>.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-[12px] border border-border bg-card">
      {apps.map((app) => (
        <Link
          key={app.gatewayId}
          to="/apps/$accountId/$gatewayId"
          params={{ accountId, gatewayId: app.gatewayId }}
          className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  app.status === "ready" ? "bg-green-500" : "bg-destructive"
                }`}
              />
              <span className="truncate font-mono text-sm font-semibold text-foreground">
                {app.metadata?.title ?? app.gatewayId}
              </span>
            </div>
            {app.domain && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {app.domain}
              </Badge>
            )}
          </div>
          {app.openUrl && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />}
        </Link>
      ))}
    </div>
  );
}
