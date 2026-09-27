import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  FlaskIcon,
  GearSixIcon,
  ShieldCheckIcon,
  StackIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { buildRegistryConfigUrl } from "everything-dev/fastkv";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildDraftFromResolvedConfig,
  buildTenantUrl,
  computeSsrEntryIntegrity,
  computeUiEntryIntegrity,
  diffDraft,
  draftUiOverride,
  emptyTenantConfigDraft,
  type IntegrityCheckResult,
  normalizeBundleBaseUrl,
  type TenantConfigDraft,
  tenantConfigDraftSchema,
  useApiClient,
  useAuthClient,
  verifySsrIntegrity,
  verifyUiIntegrity,
} from "@/app";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FieldLabel,
  InfoPopover,
  InfoRow,
  Input,
  SectionHeader,
} from "@/components";
import { ConnectDao } from "@/components/connect-dao";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { describeDaoError, useDaoConnection } from "@/lib/dao-connect";
import {
  invalidateTenantQueries,
  tenantBindingsQueryOptions,
  tenantByOrgQueryOptions,
} from "@/lib/queries/tenants";
import {
  approvalThreshold,
  CONFIG_WRITE_PLAN,
  fetchDaoProposals,
  fetchSputnikPolicy,
  findPendingProposalForPlan,
} from "@/lib/sputnik-proposals";
import { publishTenantConfigForMode } from "@/lib/tenant-deploy";
import { useNearAccount } from "@/lib/use-near-account";
import { resolvePrimaryHostname } from "../../../_admin/_dashboard/admin/tenants/-tenant-wizard";
import { waitFor } from "../-poc-chain";

const REFETCH_MS = 15_000;

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

  const { data: tenant } = useQuery(tenantByOrgQueryOptions(apiClient, orgId));

  const daoOwned = tenant?.ownerKind === "dao";
  const tenantAccount = tenant?.accountId ?? "";

  const { data: bindings } = useQuery({
    ...tenantBindingsQueryOptions(apiClient, tenant?.id ?? ""),
    enabled: !!tenant,
  });
  const hostname = resolvePrimaryHostname(bindings);

  const registryQuery = useQuery({
    queryKey: ["node-config", "registry-app", tenantAccount, gatewayId],
    queryFn: async () => {
      try {
        const result = await apiClient.apps.getRegistryApp({
          accountId: tenantAccount,
          gatewayId,
        });
        return result.data ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!tenant && !!gatewayId,
    refetchInterval: REFETCH_MS,
  });
  const registryApp = registryQuery.data;
  const resolvedConfig = registryApp?.resolvedConfig ?? null;
  const configPublished = !!registryApp;

  const { data: daoProposals = [] } = useQuery({
    queryKey: ["node-config", "dao-proposals", tenantAccount],
    queryFn: () => fetchDaoProposals(tenantAccount),
    enabled: daoOwned && !!tenantAccount,
    refetchInterval: REFETCH_MS,
  });
  const { data: daoPolicy } = useQuery({
    queryKey: ["node-config", "dao-policy", tenantAccount],
    queryFn: () => fetchSputnikPolicy(tenantAccount),
    enabled: daoOwned && !!tenantAccount,
    refetchInterval: REFETCH_MS,
  });

  const pendingConfigProposal = daoOwned
    ? findPendingProposalForPlan(daoProposals, CONFIG_WRITE_PLAN)
    : null;
  const pendingThreshold = approvalThreshold(daoPolicy, pendingConfigProposal);

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
  const [sourceAccount, setSourceAccount] = useState("");
  const [fetchingSource, setFetchingSource] = useState(false);

  const onFillFromDeployedApp = async () => {
    const account = sourceAccount.trim();
    if (!account) {
      toast.error("Enter the NEAR account your app deployed under");
      return;
    }
    setFetchingSource(true);
    try {
      const result = await apiClient.apps.getRegistryApp({ accountId: account, gatewayId });
      const resolved = result.data?.resolvedConfig ?? null;
      const ui =
        (resolved?.app as { ui?: { production?: unknown; integrity?: unknown } } | null)?.ui ?? {};
      const production = typeof ui.production === "string" ? ui.production : "";
      const integrity = typeof ui.integrity === "string" ? ui.integrity : "";
      if (!production || !integrity) {
        toast.error(
          `${account} publishes no custom UI bundle yet — run \`bos publish --deploy\` in the app repo with a local UI first.`,
        );
        return;
      }
      const ssr =
        (resolved?.app as { ui?: { ssr?: unknown; ssrIntegrity?: unknown } } | null)?.ui ?? {};
      const ssrUrl = typeof ssr.ssr === "string" ? ssr.ssr : "";
      const ssrIntegrity = typeof ssr.ssrIntegrity === "string" ? ssr.ssrIntegrity : "";
      setDraft((prev) => ({
        ...prev,
        uiProduction: production,
        uiIntegrity: integrity,
        ...(tenant?.allowSsr && ssrUrl && ssrIntegrity ? { ssrUrl, ssrIntegrity } : {}),
      }));
      toast.success(`Bundle and integrity filled from ${account}`);
    } catch {
      toast.error(
        `No published config for ${account} on this gateway — run \`bos publish --deploy\` in the app repo first.`,
      );
    } finally {
      setFetchingSource(false);
    }
  };

  const fetchPublishedNow = () =>
    apiClient.apps
      .getRegistryApp({ accountId: tenantAccount, gatewayId })
      .then((result) => result.data ?? null)
      .catch(() => null);

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

  const onVerifyBundle = async (
    url: string,
    currentIntegrity: string,
    compute: (url: string) => Promise<string>,
    apply: (computed: string) => void,
    label: string,
  ) => {
    setComputing(true);
    try {
      const computed = await compute(url);
      if (!currentIntegrity) {
        apply(computed);
        toast.success(`${label} integrity filled from the bundle`);
        return;
      }
      if (computed === currentIntegrity) {
        toast.success(`${label} integrity matches the bundle`);
      } else {
        toast.error(`${label} integrity mismatch — the bundle hashes to ${computed}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setComputing(false);
    }
  };

  const onVerifyUiBundle = () => {
    if (!draft.uiProduction) {
      toast.error("Enter the UI bundle URL first");
      return;
    }
    return onVerifyBundle(
      draft.uiProduction,
      draft.uiIntegrity,
      computeUiEntryIntegrity,
      (computed) => setDraft((prev) => ({ ...prev, uiIntegrity: computed })),
      "UI",
    );
  };

  const onVerifySsrBundle = () => {
    if (!draft.ssrUrl) {
      toast.error("Enter the SSR bundle URL first");
      return;
    }
    return onVerifyBundle(
      draft.ssrUrl,
      draft.ssrIntegrity,
      computeSsrEntryIntegrity,
      (computed) => setDraft((prev) => ({ ...prev, ssrIntegrity: computed })),
      "SSR",
    );
  };

  const onPropose = async () => {
    if (!parsedDraft.success) {
      toast.error(parsedDraft.error.issues[0]?.message ?? "Fix the form first");
      return;
    }
    const value = parsedDraft.data;
    const checks: { label: string; check: IntegrityCheckResult }[] = [];
    if (value.uiProduction && value.uiIntegrity) {
      setVerifying(true);
      try {
        checks.push({
          label: "UI",
          check: await verifyUiIntegrity(value.uiProduction, value.uiIntegrity),
        });
      } finally {
        setVerifying(false);
      }
    }
    if (value.ssrUrl && value.ssrIntegrity) {
      setVerifying(true);
      try {
        checks.push({
          label: "SSR",
          check: await verifySsrIntegrity(value.ssrUrl, value.ssrIntegrity),
        });
      } finally {
        setVerifying(false);
      }
    }
    for (const { label, check } of checks) {
      if (check.status === "mismatch") {
        toast.error(`${label} integrity mismatch — the bundle hashes to ${check.computed}`);
        return;
      }
      if (check.status === "unverified") {
        setUnverified(`Couldn't fetch the ${label} bundle to verify it (${check.reason}).`);
        return;
      }
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
            {bundleOpen && (
              <FieldGroup>
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="orgs-node-config-source-account">
                    Fill from a deployed app
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="orgs-node-config-source-account"
                      type="text"
                      value={sourceAccount}
                      placeholder="<your-app>.near — the account that ran bos publish --deploy"
                      onChange={(event) => setSourceAccount(event.target.value)}
                      disabled={!editable}
                      className="font-mono"
                      data-testid="orgs-node-config-source-account"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onFillFromDeployedApp()}
                      disabled={!editable || fetchingSource}
                      data-testid="orgs-node-config-autofill"
                    >
                      {fetchingSource ? <Spinner /> : null}
                      Fetch bundle
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Reads the published config of your deployed app and fills the bundle URL and
                    integrity below.
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <ConfigField
                    id="orgs-node-config-ui-url"
                    label="UI bundle URL"
                    value={draft.uiProduction}
                    onChange={(value) => setDraft((prev) => ({ ...prev, uiProduction: value }))}
                    onBlur={() =>
                      setDraft((prev) => ({
                        ...prev,
                        uiProduction: normalizeBundleBaseUrl(prev.uiProduction),
                      }))
                    }
                    placeholder="https://example.com/bundles/<account>/<gateway>/plugin/"
                    mono
                    disabled={!editable}
                  />
                  <Button
                    type="button"
                    onClick={() => void onVerifyUiBundle()}
                    disabled={!editable || computing || !draft.uiProduction}
                    variant="link"
                    size="xs"
                    className="self-start"
                    data-testid="orgs-node-config-verify"
                  >
                    {computing ? "Hashing…" : "Verify and fill integrity"}
                  </Button>
                </div>
                <ConfigField
                  id="orgs-node-config-ui-integrity"
                  label="UI integrity"
                  value={draft.uiIntegrity}
                  onChange={(value) => setDraft((prev) => ({ ...prev, uiIntegrity: value }))}
                  placeholder="sha384-…"
                  mono
                  disabled={!editable}
                />
                {tenant.allowSsr && (
                  <>
                    <div className="flex flex-col gap-1">
                      <ConfigField
                        id="orgs-node-config-ssr-url"
                        label="SSR bundle URL"
                        value={draft.ssrUrl}
                        onChange={(value) => setDraft((prev) => ({ ...prev, ssrUrl: value }))}
                        onBlur={() =>
                          setDraft((prev) => ({
                            ...prev,
                            ssrUrl: normalizeBundleBaseUrl(prev.ssrUrl),
                          }))
                        }
                        placeholder="https://example.com/bundles/<account>/<gateway>/plugin/"
                        mono
                        disabled={!editable}
                      />
                      <Button
                        type="button"
                        onClick={() => void onVerifySsrBundle()}
                        disabled={!editable || computing || !draft.ssrUrl}
                        variant="link"
                        size="xs"
                        className="self-start"
                        data-testid="orgs-node-config-verify-ssr"
                      >
                        {computing ? "Hashing…" : "Verify and fill integrity"}
                      </Button>
                    </div>
                    <ConfigField
                      id="orgs-node-config-ssr-integrity"
                      label="SSR integrity"
                      value={draft.ssrIntegrity}
                      onChange={(value) => setDraft((prev) => ({ ...prev, ssrIntegrity: value }))}
                      placeholder="sha384-…"
                      mono
                      disabled={!editable}
                    />
                  </>
                )}
              </FieldGroup>
            )}
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

function ConfigField({
  id,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={mono ? "font-mono" : undefined}
        data-testid={id}
      />
    </Field>
  );
}
