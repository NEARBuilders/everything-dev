import { createFileRoute } from "@tanstack/react-router";
import { getAccount, getActiveRuntime, getAppName, getRepository } from "@/app";
import { Card } from "@/components";
import { InfoRow } from "@/components/ui/info-row";

export const Route = createFileRoute("/_layout/_admin/admin/system")({
  loader: async ({ context }) => ({
    runtimeConfig: context.runtimeConfig,
  }),
  head: () => ({
    meta: [{ title: "Admin System | app" }],
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
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">System</h1>
          <p className="text-sm text-muted-foreground">
            Runtime configuration for this deployment.
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Runtime</h2>
          <InfoRow label="account" value={runtime?.accountId ?? account} mono />
          <InfoRow label="name" value={appName} />
          <InfoRow label="base path" value={runtimeBasePath ?? "/"} mono />
          <InfoRow label="gateway" value={runtime?.gatewayId} mono />
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Deployment</h2>
          <InfoRow label="env" value={env ?? "—"} mono />
          <InfoRow label="network" value={networkId ?? "—"} mono />
          <InfoRow label="host" value={hostUrl ?? "—"} mono />
          <InfoRow label="repository" value={repository} mono />
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Endpoints</h2>
          <InfoRow label="api" value={apiBase} mono />
          <InfoRow label="rpc" value={rpcBase} mono />
          <InfoRow label="assets" value={assetsUrl} mono />
        </Card>
      </div>
    </div>
  );
}
