import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  FlaskIcon,
  GearSixIcon,
  ShieldCheckIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { buildRegistryConfigUrl } from "everything-dev/fastkv";
import { useEffect, useMemo, useState } from "react";
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
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  InfoPopover,
  InfoRow,
  SectionHeader,
} from "@/components";
import { ConnectDao } from "@/components/connect-dao";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { describeDaoError, useDaoConnection } from "@/lib/dao-connect";
import { invalidateTenantQueries } from "@/lib/queries/tenants";
import { waitFor } from "@/lib/sputnik-proposals";
import { publishTenantConfigForMode } from "@/lib/tenant-deploy";
import { useNearAccount } from "@/lib/use-near-account";
import { ConfigField } from "./-config-field";
import { CustomUiBundleFields } from "./-custom-ui-bundle-fields";
import { runIntegrityPreflight } from "./-integrity-preflight";
import { useOrgTenantConfig } from "./-use-org-tenant-config";
import { usePendingConfigProposal } from "./-use-pending-config-proposal";

export interface NodeConfigTabProps {
  orgId: string;
  gatewayId: string;
  baseAccount: string;
  canManage: boolean;
  isPlatformAdmin?: boolean;
}

export function NodeConfigTab({
  orgId,
  gatewayId,
  baseAccount,
  canManage,
  isPlatformAdmin = false,
}: NodeConfigTabProps) {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const connection = useDaoConnection();
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
    fetchPublishedNow,
  } = useOrgTenantConfig(orgId, gatewayId);

  const { proposal: pendingConfigProposal, threshold: pendingThreshold } = usePendingConfigProposal(
    tenantAccount,
    daoOwned,
  );

  const [draft, setDraft] = useState<TenantConfigDraft>(emptyTenantConfigDraft);
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || !tenant || !registryQuery.isSuccess) return;
    setPrefilled(true);
    setDraft(buildDraftFromResolvedConfig(resolvedConfig, { title: tenant.name }));
  }, [prefilled, tenant, registryQuery.isSuccess, resolvedConfig]);

  const parsedDraft = tenantConfigDraftSchema.safeParse(draft);
  const diff = useMemo(() => diffDraft(draft, resolvedConfig), [draft, resolvedConfig]);

  const tenantUrl = hostname ? buildTenantUrl(hostname, gatewayId) : null;
  const fastKvUrl = tenantAccount ? buildRegistryConfigUrl(tenantAccount, gatewayId) : null;

  const editable = canManage && tenant?.status === "active";
  const hasSigningWallet = daoOwned
    ? connection.status === "connected" && connection.daoAccountId === tenantAccount
    : nearAccountId === tenantAccount &&
      activeNetwork === (tenantAccount.endsWith(".testnet") ? "testnet" : "mainnet");

  const [verifying, setVerifying] = useState(false);
  const [computing, setComputing] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [showBundle, setShowBundle] = useState(false);

  const configMatchesDraft = (resolved: Record<string, unknown> | null | undefined) =>
    !!resolved &&
    resolved.title === draft.title.trim() &&
    (!draft.uiProduction ||
      ((resolved.app as { ui?: { production?: string } } | undefined)?.ui?.production ?? "") ===
        draft.uiProduction.trim());

  const proposeMutation = useMutation({
    mutationFn: async () => {
      if (!tenant) throw new Error("Tenant not loaded");
      if (!gatewayId) throw new Error("Gateway not configured");
      if (!hostname) throw new Error("No primary domain binding configured for this tenant");
      const value = tenantConfigDraftSchema.parse(draft);
      const app = draftUiOverride(value);
      if (value.title !== tenant.name) {
        await apiClient.updateTenant({ tenantId: tenant.id, name: value.title });
      }
      return publishTenantConfigForMode(apiClient, auth, {
        accountId: tenant.accountId,
        gatewayId,
        baseAccount,
        hostname,
        title: value.title,
        description: value.description,
        ...(value.repository ? { repository: value.repository } : {}),
        ...(app ? { app } : {}),
        mode: daoOwned ? "dao" : "platform",
      });
    },
    onSuccess: async () => {
      if (daoOwned) {
        const live = await waitFor(
          async () => {
            const latest = await fetchPublishedNow();
            return configMatchesDraft(latest?.resolvedConfig ?? null);
          },
          30_000,
          3_000,
        );
        if (live) {
          toast.success(`Config is live at ${tenantUrl ?? hostname}`);
        } else {
          toast.info("Proposal submitted. The config goes live once it passes.");
        }
      } else {
        toast.success("Config published");
      }
      await invalidateTenantQueries(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["node-config"] });
    },
    onError: (error: Error) =>
      toast.error(describeDaoError(error, daoOwned ? tenantAccount : "the session wallet")),
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
      <div data-testid="orgs-node-config-empty">
        {!gatewayId ? (
          <EmptyState
            icon={StackIcon}
            title="Gateway not configured"
            description="The active runtime declares no gateway, so community config can't be resolved here."
          />
        ) : (
          <EmptyState
            icon={StackIcon}
            title="No community yet"
            description="Start a community to get its own site, events and staking."
            action={
              <>
                <Button nativeButton={false} render={<Link to="/apply" />}>
                  Start a community
                </Button>
                {isPlatformAdmin && (
                  <Button
                    variant="ghost"
                    nativeButton={false}
                    render={<Link to="/prototype-staking-poc" />}
                  >
                    <FlaskIcon />
                    Node lifecycle
                  </Button>
                )}
              </>
            }
          />
        )}
      </div>
    );
  }

  const busy = proposeMutation.isPending || verifying || computing;
  const proposeBlockReason = !editable
    ? !canManage
      ? "Only owners and admins can change the config."
      : `This community is ${tenant.status}.`
    : !parsedDraft.success
      ? (parsedDraft.error.issues[0]?.message ?? "Fix the form first.")
      : !hasSigningWallet
        ? daoOwned
          ? `Connect ${tenantAccount} via Trezu to propose.`
          : "Connect your NEAR wallet to publish."
        : null;
  const canPropose = editable && parsedDraft.success && hasSigningWallet && !busy;
  const bundleOpen = showBundle || !!draft.uiProduction || !!draft.ssrUrl;
  const allowed = [
    tenant.allowUiOverrides ? "Custom UI" : null,
    tenant.allowSsr ? "Server rendering" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Published config"
          sectionTestId="orgs-node-config-state"
          action={
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/tenant/$tenantId" params={{ tenantId: tenant.id }} />}
              data-testid="orgs-node-config-settings"
            >
              <GearSixIcon />
              Community settings
            </Button>
          }
        />
        <div className="flex flex-col">
          <InfoRow
            label="Status"
            value={
              <span
                className="inline-flex flex-wrap items-center justify-end gap-2"
                data-testid="orgs-node-config-config"
              >
                {configPublished ? (
                  <Badge variant="success">Live</Badge>
                ) : pendingConfigProposal ? (
                  <Badge variant="warning">Awaiting votes · #{pendingConfigProposal.id}</Badge>
                ) : (
                  <Badge variant="outline">Not published</Badge>
                )}
                {fastKvUrl && (
                  <a
                    href={fastKvUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    FastKV
                  </a>
                )}
              </span>
            }
          />
          <InfoRow
            label="Address"
            value={
              tenantUrl && configPublished ? (
                <a
                  href={tenantUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 underline underline-offset-2"
                  data-testid="orgs-node-config-open-tenant"
                >
                  <span className="min-w-0 break-all">{tenantUrl.replace(/^https?:\/\//, "")}</span>
                  <ArrowSquareOutIcon className="size-3.5 shrink-0" />
                </a>
              ) : (
                (hostname ?? "Not bound yet")
              )
            }
            mono
          />
          <InfoRow label="Owner" value={daoOwned ? "DAO · changes go live by vote" : "Platform"} />
          <InfoRow label="Account" value={tenantAccount} mono />
          {pendingConfigProposal && (
            <InfoRow
              label="Pending proposal"
              value={`#${pendingConfigProposal.id} · ${pendingThreshold.approved}${
                pendingThreshold.required == null ? "" : `/${pendingThreshold.required}`
              } approvals`}
            />
          )}
          <InfoRow
            label="Allowed"
            value={allowed.length > 0 ? allowed.join(" · ") : "Metadata only"}
          />
        </div>
      </section>

      {daoOwned && <ConnectDao purpose="community-settings" />}

      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Customize"
          sectionTestId="orgs-node-config-editor"
          description={
            daoOwned
              ? "Changes go live when the DAO proposal passes."
              : "Changes publish immediately."
          }
        />

        {!editable && (
          <p className="text-sm text-muted-foreground" data-testid="orgs-node-config-locked">
            {proposeBlockReason}
          </p>
        )}

        <FieldGroup className="max-w-2xl">
          <ConfigField
            id="orgs-node-config-title"
            label="Title"
            value={draft.title}
            onChange={(value) => setDraft((prev) => ({ ...prev, title: value }))}
            disabled={!editable}
          />
          <ConfigField
            id="orgs-node-config-description"
            label="Description"
            value={draft.description}
            onChange={(value) => setDraft((prev) => ({ ...prev, description: value }))}
            disabled={!editable}
          />
          <ConfigField
            id="orgs-node-config-repository"
            label="Repository"
            value={draft.repository}
            onChange={(value) => setDraft((prev) => ({ ...prev, repository: value }))}
            placeholder="https://github.com/…"
            mono
            disabled={!editable}
          />
        </FieldGroup>

        {tenant.allowUiOverrides && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setShowBundle((open) => !open)}
                aria-expanded={bundleOpen}
                data-testid="orgs-node-config-bundle-toggle"
              >
                {bundleOpen ? <CaretDownIcon /> : <CaretRightIcon />}
                Custom UI bundle
              </Button>
              <InfoPopover
                title="Custom UI bundle"
                body="A deployed UI bundle that replaces the platform UI for this community. Integrity is the sha384 of <base>/remoteEntry.js (SSR: remoteEntry.server.js). A mismatch makes the host refuse the community until fixed."
              />
            </div>
            <CustomUiBundleFields
              idPrefix="orgs-node-config"
              draft={draft}
              setDraft={setDraft}
              allowSsr={tenant.allowSsr}
              disabled={!editable}
              gatewayId={gatewayId}
              collapsed={!bundleOpen}
              onComputingChange={setComputing}
            />
          </div>
        )}

        {diff.length > 0 && (
          <div className="flex max-w-2xl flex-col gap-2" data-testid="orgs-node-config-diff">
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
            title={proposeBlockReason ?? undefined}
            data-testid="orgs-node-config-propose"
          >
            {busy ? <Spinner /> : <ShieldCheckIcon />}
            {daoOwned ? "Propose changes" : "Publish changes"}
          </Button>
          {editable && proposeBlockReason && (
            <span className="text-sm text-muted-foreground">{proposeBlockReason}</span>
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
