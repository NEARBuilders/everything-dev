import { ArrowSquareOutIcon, HouseIcon, StackIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildDraftFromResolvedConfig,
  buildTenantUrl,
  diffDraft,
  draftUiOverride,
  emptyTenantConfigDraft,
  type TenantConfigDraft,
  tenantConfigDraftSchema,
  useApiClient,
  useAuthClient,
} from "@/app";
import { Badge, Button, ConfirmDialog, EmptyState, InfoRow, SectionHeader } from "@/components";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { invalidateTenantQueries } from "@/lib/queries/tenants";
import { canAccountPropose, trezuDaoUrl } from "@/lib/sputnik-proposals";
import { proposeTenantConfigAsMember, publishTenantConfigForMode } from "@/lib/tenant-deploy";
import { useNearAccount } from "@/lib/use-near-account";
import { ConfigField } from "./-config-field";
import { CustomUiBundleFields } from "./-custom-ui-bundle-fields";
import { runIntegrityPreflight } from "./-integrity-preflight";
import { useOrgTenantConfig } from "./-use-org-tenant-config";
import { usePendingConfigProposal } from "./-use-pending-config-proposal";

export interface HomepageTabProps {
  orgId: string;
  gatewayId: string;
  baseAccount: string;
  canManage: boolean;
  isActive: boolean;
}

export function HomepageTab({
  orgId,
  gatewayId,
  baseAccount,
  canManage,
  isActive,
}: HomepageTabProps) {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const nearAccountId = useNearAccount();
  const activeNetwork = auth.useActiveNetwork();

  const {
    tenant,
    daoOwned,
    tenantAccount,
    hostname,
    registryQuery,
    resolvedConfig,
    configPublished,
  } = useOrgTenantConfig(orgId, gatewayId);

  const {
    proposal: pendingProposal,
    threshold,
    policy,
  } = usePendingConfigProposal(tenantAccount, daoOwned);

  const [draft, setDraft] = useState<TenantConfigDraft>(emptyTenantConfigDraft);
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (edited || !tenant || !registryQuery.isSuccess) return;
    setDraft(buildDraftFromResolvedConfig(resolvedConfig, { title: tenant.name }));
  }, [edited, tenant, registryQuery.isSuccess, resolvedConfig]);
  const editDraft: Dispatch<SetStateAction<TenantConfigDraft>> = (update) => {
    setEdited(true);
    setDraft(update);
  };

  const parsedDraft = tenantConfigDraftSchema.safeParse(draft);
  const diff = useMemo(() => diffDraft(draft, resolvedConfig), [draft, resolvedConfig]);

  const [verifying, setVerifying] = useState(false);
  const [computing, setComputing] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);

  const tenantUrl = hostname ? buildTenantUrl(hostname, gatewayId) : null;
  const editable = canManage && tenant?.status === "active";
  const hasSigningWallet =
    nearAccountId === tenantAccount &&
    activeNetwork === (tenantAccount.endsWith(".testnet") ? "testnet" : "mainnet");

  const proposeMutation = useMutation({
    mutationFn: async () => {
      if (!tenant) throw new Error("Tenant not loaded");
      if (!gatewayId) throw new Error("Gateway not configured");
      if (!hostname) throw new Error("No primary domain binding configured for this tenant");
      const value = tenantConfigDraftSchema.parse(draft);
      const app = draftUiOverride(value);
      const common = {
        gatewayId,
        baseAccount,
        hostname,
        title: value.title,
        description: value.description,
        ...(value.repository ? { repository: value.repository } : {}),
        ...(app ? { app } : {}),
      };
      if (daoOwned) {
        return proposeTenantConfigAsMember(apiClient, auth.near, {
          daoAccountId: tenant.accountId,
          ...common,
        });
      }
      if (value.title !== tenant.name) {
        await apiClient.updateTenant({ tenantId: tenant.id, name: value.title });
      }
      return publishTenantConfigForMode(apiClient, auth, {
        accountId: tenant.accountId,
        ...common,
        mode: "platform",
      });
    },
    onSuccess: async () => {
      toast.success(
        daoOwned
          ? "Proposal submitted. The homepage goes live once it passes."
          : "Homepage published",
      );
      await invalidateTenantQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["node-config"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const onPropose = async () => {
    if (!parsedDraft.success) {
      toast.error(parsedDraft.error.issues[0]?.message ?? "Fix the form first");
      return;
    }
    setVerifying(true);
    let preflight: Awaited<ReturnType<typeof runIntegrityPreflight>>;
    try {
      preflight = await runIntegrityPreflight(parsedDraft.data);
    } finally {
      setVerifying(false);
    }
    if (preflight.status === "mismatch") {
      toast.error(preflight.message);
      return;
    }
    if (preflight.status === "unverified") {
      setUnverified(preflight.message);
      return;
    }
    proposeMutation.mutate();
  };

  if (!tenant || !gatewayId) {
    return (
      <div data-testid="orgs-homepage-empty">
        <EmptyState
          icon={StackIcon}
          title={gatewayId ? "No community yet" : "Gateway not configured"}
          description={
            gatewayId
              ? "Start a community to give it a homepage."
              : "The active runtime declares no gateway, so the homepage can't be resolved here."
          }
        />
      </div>
    );
  }

  const busy = proposeMutation.isPending || verifying || computing;
  const blockReason = !canManage
    ? "Only owners and admins can propose a new homepage."
    : !isActive
      ? "Make this organization active to propose a new homepage."
      : tenant.status !== "active"
        ? `This community is ${tenant.status}.`
        : !parsedDraft.success
          ? (parsedDraft.error.issues[0]?.message ?? "Fix the form first.")
          : daoOwned && !nearAccountId
            ? "Connect your NEAR wallet to propose."
            : daoOwned && activeNetwork !== "mainnet"
              ? "Switch your NEAR wallet to mainnet to propose."
              : daoOwned && policy && !canAccountPropose(policy, nearAccountId)
                ? `${nearAccountId} has no AddProposal permission on ${tenantAccount}.`
                : !daoOwned && !hasSigningWallet
                  ? "Connect your NEAR wallet to publish."
                  : null;
  const canPropose = blockReason === null && !busy;

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <SectionHeader title="Homepage" sectionTestId="orgs-homepage-state" />
        <div className="flex flex-col">
          <InfoRow
            label="Status"
            value={
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                {pendingProposal ? (
                  <Badge variant="warning" data-testid="orgs-homepage-pending">
                    Awaiting votes · #{pendingProposal.id}
                  </Badge>
                ) : configPublished ? (
                  <Badge variant="success">Live</Badge>
                ) : (
                  <Badge variant="outline">Not published</Badge>
                )}
              </span>
            }
          />
          {pendingProposal && (
            <>
              <InfoRow
                label="Approvals"
                value={
                  <span data-testid="orgs-homepage-threshold">
                    {threshold.approved}
                    {threshold.required == null ? "" : `/${threshold.required}`} approvals
                  </span>
                }
              />
              <InfoRow
                label="Vote"
                value={
                  <a
                    href={trezuDaoUrl(tenantAccount)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                    data-testid="orgs-homepage-trezu-link"
                  >
                    Vote on trezu.app
                    <ArrowSquareOutIcon className="size-3.5 shrink-0" />
                  </a>
                }
              />
            </>
          )}
          {tenantUrl && configPublished && (
            <InfoRow
              label="Address"
              value={
                <Link to="/tenant/$tenantId" params={{ tenantId: tenant.id }}>
                  {tenantUrl.replace(/^https?:\/\//, "")}
                </Link>
              }
              mono
            />
          )}
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Propose a new homepage"
          description={
            daoOwned
              ? "Changes go live when the DAO proposal passes."
              : "Changes publish immediately."
          }
        />

        <FieldGroup className="max-w-2xl">
          <ConfigField
            id="orgs-homepage-title"
            label="Title"
            value={draft.title}
            onChange={(value) => editDraft((prev) => ({ ...prev, title: value }))}
            disabled={!editable}
          />
          <ConfigField
            id="orgs-homepage-description"
            label="Description"
            value={draft.description}
            onChange={(value) => editDraft((prev) => ({ ...prev, description: value }))}
            disabled={!editable}
          />
        </FieldGroup>

        {tenant.allowUiOverrides ? (
          <div className="flex max-w-2xl flex-col gap-4">
            <CustomUiBundleFields
              idPrefix="orgs-homepage"
              draft={draft}
              setDraft={editDraft}
              allowSsr={tenant.allowSsr}
              disabled={!editable}
              gatewayId={gatewayId}
              onComputingChange={setComputing}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="orgs-homepage-ui-disabled">
            Custom UI bundles aren't enabled for this community.
          </p>
        )}

        {diff.length > 0 && (
          <div className="flex max-w-2xl flex-col gap-2" data-testid="orgs-homepage-diff">
            <p className="text-sm font-medium text-foreground">
              {diff.length} change{diff.length === 1 ? "" : "s"}
            </p>
            {diff.map((entry) => (
              <p key={entry.field} className="truncate font-mono text-xs text-muted-foreground">
                {entry.field}: {entry.from || "—"} →{" "}
                <span className="text-foreground">{entry.to || "—"}</span>
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void onPropose()}
            disabled={!canPropose}
            title={blockReason ?? undefined}
            data-testid="orgs-homepage-propose"
          >
            {busy ? <Spinner /> : <HouseIcon />}
            {daoOwned ? "Propose new homepage" : "Publish new homepage"}
          </Button>
          {blockReason && (
            <span
              className="text-sm text-muted-foreground"
              data-testid="orgs-homepage-block-reason"
            >
              {blockReason}
            </span>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={unverified !== null}
        onOpenChange={(open) => !open && setUnverified(null)}
        title={daoOwned ? "Propose without verifying?" : "Publish without verifying?"}
        description={unverified ?? ""}
        confirmLabel={daoOwned ? "Propose anyway" : "Publish anyway"}
        onConfirm={() => {
          setUnverified(null);
          proposeMutation.mutate();
        }}
      />
    </div>
  );
}
