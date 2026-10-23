import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { getAccount, getGatewayId, useApiClient } from "@/app";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Label,
  LocalDate,
  PageContainer,
  PageHeader,
  SectionHeader,
  Skeleton,
} from "@/components";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_authenticated/deploys")({
  validateSearch: (search: Record<string, unknown>) => ({
    account: typeof search.account === "string" && search.account ? search.account : undefined,
    gateway: typeof search.gateway === "string" && search.gateway ? search.gateway : undefined,
  }),
  loader: async ({ context }) => ({
    runtimeConfig: context.runtimeConfig,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Deploys", match.context.runtimeConfig) }],
  }),
  component: DeploysPage,
});

function DeploysPage() {
  const { runtimeConfig } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null);

  const account = search.account ?? getAccount(runtimeConfig);
  const gateway = search.gateway ?? getGatewayId(runtimeConfig) ?? "";
  const ownAccount = getAccount(runtimeConfig);
  const ownGateway = getGatewayId(runtimeConfig) ?? "";
  const canRollback = Boolean(ownGateway) && account === ownAccount && gateway === ownGateway;

  const deploys = useQuery({
    queryKey: ["deploys", account, gateway],
    queryFn: () => apiClient.hosting.listDeploys({ account, gateway, limit: 50 }),
    staleTime: 30 * 1000,
  });

  const rollback = useMutation({
    mutationFn: (blockHeight: number) =>
      apiClient.hosting.rollback({ account, gateway, blockHeight }),
    onSuccess: (result) => {
      setRollbackTarget(null);
      if (result.status === "published") {
        toast.success(
          `Rolled back to the snapshot at block height ${result.blockHeight}${result.txHash ? ` — tx ${result.txHash}` : ""}`,
        );
        void queryClient.invalidateQueries({ queryKey: ["deploys", account, gateway] });
      } else {
        toast.error(result.reason ?? "Rollback refused");
      }
    },
    onError: (error) => {
      setRollbackTarget(null);
      toast.error(error instanceof Error ? error.message : "Rollback failed");
    },
  });

  const rows = deploys.data?.deploys ?? [];

  return (
    <PageContainer>
      <PageHeader
        headerTestId="deploys.heading"
        title="Deploys"
        description="Publish history for this runtime, resolved from the per-deploy audit manifests on the FastKV registry."
      />

      <form
        className="flex flex-wrap items-end gap-3"
        data-testid="deploys-namespace-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const field = (name: string) => {
            const value = data.get(name);
            return typeof value === "string" ? value.trim() : "";
          };
          void navigate({
            to: "/deploys",
            search: {
              account: field("account") || undefined,
              gateway: field("gateway") || undefined,
            },
          });
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="deploys-account">Account</Label>
          <Input
            id="deploys-account"
            name="account"
            defaultValue={account}
            key={`account-${account}`}
            className="w-64 font-mono"
            data-testid="deploys-account-input"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="deploys-gateway">Gateway</Label>
          <Input
            id="deploys-gateway"
            name="gateway"
            defaultValue={gateway}
            key={`gateway-${gateway}`}
            className="w-64 font-mono"
            data-testid="deploys-gateway-input"
          />
        </div>
        <Button type="submit" variant="outline" data-testid="deploys-namespace-apply">
          Load
        </Button>
      </form>

      <section className="flex flex-col gap-6">
        <SectionHeader title="History" sectionTestId="deploys.section.history" />
        {deploys.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        ) : deploys.isError ? (
          <EmptyState
            title="Couldn't load deploy history"
            description={
              deploys.error instanceof Error
                ? deploys.error.message
                : "The registry read failed — try another namespace."
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No deploys yet"
            description={`No audit manifests are published under ${account} / ${gateway || "—"}.`}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((deploy, index) => (
              <div
                key={deploy.key}
                className="flex flex-col gap-3 rounded-2xl border border-border p-4"
                data-testid={`deploys-row-${index}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <LocalDate value={deploy.publishedAt} format="datetime" />
                  {deploy.network && (
                    <Badge variant="outline" data-testid={`deploys-network-${index}`}>
                      {deploy.network}
                    </Badge>
                  )}
                  {deploy.rolledBackFrom && (
                    <Badge
                      variant="warning"
                      data-testid={`deploys-rollback-${index}`}
                      title={`Rolled back to the snapshot published at ${deploy.rolledBackFrom}`}
                    >
                      rolled back from {deploy.rolledBackFrom}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  {deploy.fingerprint && (
                    <div className="flex gap-2 text-muted-foreground">
                      <span className="shrink-0">fingerprint</span>
                      <span
                        className="font-mono break-all text-foreground"
                        data-testid={`deploys-fingerprint-${index}`}
                      >
                        {deploy.fingerprint}
                      </span>
                    </div>
                  )}
                  {deploy.imageRef && (
                    <div className="flex gap-2 text-muted-foreground">
                      <span className="shrink-0">image pin</span>
                      <span
                        className="font-mono break-all text-foreground"
                        data-testid={`deploys-image-${index}`}
                      >
                        {deploy.imageRef}
                      </span>
                    </div>
                  )}
                  {deploy.platformManifest && (
                    <div className="flex gap-2 text-muted-foreground">
                      <span className="shrink-0">platform pin</span>
                      <span className="font-mono break-all text-foreground">
                        {deploy.platformManifest.file} @ {deploy.platformManifest.integrity}
                      </span>
                    </div>
                  )}
                  {deploy.registryUrl && (
                    <div className="flex gap-2 text-muted-foreground">
                      <span className="shrink-0">registry</span>
                      <span className="font-mono break-all">{deploy.registryUrl}</span>
                    </div>
                  )}
                </div>
                {canRollback && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`deploys-rollback-button-${index}`}
                      onClick={() => setRollbackTarget(deploy.blockHeight)}
                      disabled={rollback.isPending}
                    >
                      Roll back to this deploy
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null);
        }}
        title="Roll back to this deploy?"
        description={`Republishes the config snapshot at block height ${rollbackTarget ?? ""} with its pinned slots verified (a slot whose bytes are gone or no longer match its SRI refuses the rollback). The instance then converges to the rolled-back pin on the reconciler's next tick.`}
        confirmLabel="Roll back"
        variant="destructive"
        isPending={rollback.isPending}
        onConfirm={() => {
          if (rollbackTarget !== null) rollback.mutate(rollbackTarget);
        }}
      />
    </PageContainer>
  );
}
