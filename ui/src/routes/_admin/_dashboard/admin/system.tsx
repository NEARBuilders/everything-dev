import { createFileRoute } from "@tanstack/react-router";
import { getAccount, getActiveRuntime, getAppName, getRepository } from "@/app";
import { Badge, InfoRow, PageHeader, SectionHeader } from "@/components";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_admin/_dashboard/admin/system")({
  loader: async ({ context }) => ({
    runtimeConfig: context.runtimeConfig,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("System · Admin", match.context.runtimeConfig) }],
  }),
  component: AdminSystem,
});

function AdminSystem() {
  const { runtimeConfig } = Route.useLoaderData();
  const account = getAccount(runtimeConfig);
  const appName = getAppName(runtimeConfig);
  const repository = getRepository(runtimeConfig);
  const runtime = getActiveRuntime(runtimeConfig);

  const env = runtimeConfig?.env;
  const networkId = runtimeConfig?.networkId;
  const hostUrl = runtimeConfig?.hostUrl;
  const apiBase = runtimeConfig?.apiBase;
  const rpcBase = runtimeConfig?.rpcBase;
  const assetsUrl = runtimeConfig?.assetsUrl;
  const runtimeBasePath = runtime?.runtimeBasePath;

  return (
    <>
      <PageHeader
        title="System"
        description="Runtime configuration for this deployment."
        actions={
          <div className="flex flex-wrap gap-2">
            {env && (
              <Badge
                variant={env === "production" ? "success" : "warning"}
                data-testid="admin-system-env"
              >
                {env}
              </Badge>
            )}
            {networkId && (
              <Badge variant="outline" data-testid="admin-system-network">
                {networkId}
              </Badge>
            )}
          </div>
        }
        headerTestId="admin-system.heading"
      />

      <section className="flex flex-col gap-6">
        <SectionHeader title="Runtime" sectionTestId="admin.heading.runtime" />
        <div className="flex flex-col">
          <InfoRow label="Account" value={runtime?.accountId ?? account} mono />
          <InfoRow label="Name" value={appName} />
          <InfoRow label="Gateway" value={runtime?.gatewayId} mono />
          <InfoRow label="Base path" value={runtimeBasePath ?? "/"} mono />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="Deployment" sectionTestId="admin.heading.deployment" />
        <div className="flex flex-col">
          <InfoRow label="Environment" value={env ?? "—"} mono />
          <InfoRow label="Network" value={networkId ?? "—"} mono />
          <InfoRow label="Host" value={hostUrl ?? "—"} mono />
          <InfoRow label="Repository" value={repository} mono />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader title="Endpoints" sectionTestId="admin.heading.endpoints" />
        <div className="flex flex-col">
          <InfoRow label="API" value={apiBase} mono />
          <InfoRow label="RPC" value={rpcBase} mono />
          <InfoRow label="Assets" value={assetsUrl} mono />
        </div>
      </section>
    </>
  );
}
