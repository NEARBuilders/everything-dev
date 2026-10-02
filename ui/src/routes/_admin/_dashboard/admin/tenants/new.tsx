import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { buildRegistryConfigUrl } from "everything-dev/fastkv";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getAccount, getGatewayId, sessionQueryKey, useApiClient, useAuthClient } from "@/app";
import { useStepper } from "@/components";
import { disconnectDaoAccount, useDaoConnection } from "@/lib/dao-connect";
import { pageTitle } from "@/lib/page-title";
import {
  childNodesQueryOptions,
  invalidateNodeQueries,
  rootNodesQueryOptions,
} from "@/lib/queries/nodes";
import { bindingPreflightQueryOptions, invalidateTenantQueries } from "@/lib/queries/tenants";
import { publishDaoTenantConfig } from "@/lib/tenant-deploy";
import { humanize } from "../-admin-ui";
import { createTenantResources } from "./-tenant-creation";
import { TenantCreationStage } from "./-tenant-creation-stage";
import { TenantDeployPhase } from "./-tenant-deploy-phase";
import { useTenantWizardForm } from "./-tenant-form";
import { type NearNetworkId, type TenantWizardValues, tenantWizardSchema } from "./-tenant-wizard";
import { loadTenantWizardParents } from "./-tenant-wizard-loader";

interface FastKvEntry {
  current_account_id?: string;
  key?: string;
  value?: unknown;
}

async function fastKvAccountHasConfig(daoAccountId: string, gatewayId: string): Promise<boolean> {
  const url = buildRegistryConfigUrl(daoAccountId, gatewayId);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return false;
  const payload = (await res.json()) as { entries?: Array<FastKvEntry | null> };
  return Boolean(payload.entries?.find((entry) => entry && entry.value != null));
}

export const Route = createFileRoute("/_admin/_dashboard/admin/tenants/new")({
  loader: ({ context }) =>
    loadTenantWizardParents({
      activeOrganizationId: context.auth.activeOrganizationId,
      apiClient: context.apiClient,
      queryClient: context.queryClient,
    }),
  head: ({ match }) => ({
    title: pageTitle("New site · Admin", match.context.runtimeConfig),
    meta: [{ name: "description", content: "Create a new tenant, node, and domain binding." }],
  }),
  component: NewTenantPage,
});

function NewTenantPage() {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const initialRootNodes = Route.useLoaderData();
  const { auth: adminAuth, runtimeConfig } = Route.useRouteContext();
  const gatewayId = getGatewayId(runtimeConfig);
  const baseAccount = getAccount(runtimeConfig);
  const activeNetwork = auth.useActiveNetwork() as NearNetworkId;
  const hasOrg = !!adminAuth.activeOrganizationId;
  const daoConnection = useDaoConnection();

  const [phase, setPhase] = useState<"form" | "deploy">("form");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const orgSlugManuallyEdited = useRef(false);
  const [rootParentId, setRootParentId] = useState<string>(initialRootNodes[0]?.id ?? "");
  const slugManuallyEdited = useRef(false);
  const tenantNameManuallyEdited = useRef(false);
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "verified" | "failed">(
    "idle",
  );
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);

  const stepper = useStepper([
    { id: "create", label: "Create site, community and domain", blocking: true },
    { id: "publish", label: "Publish config as DAO", blocking: false },
  ]);

  const form = useTenantWizardForm((value) => submitMutation.mutateAsync(value));

  const formValues = useSelector(form.store, (state) => state.values);
  const { kind, slug, name, tenantName } = formValues;
  const hostname = useMemo(
    () => (slug && gatewayId ? `${slug}.${gatewayId}` : ""),
    [slug, gatewayId],
  );

  const { data: queriedRootNodes } = useQuery({
    ...rootNodesQueryOptions(apiClient),
    enabled: phase === "form" && hasOrg,
  });
  const rootNodes = queriedRootNodes ?? initialRootNodes;

  const { data: stateNodes = [] } = useQuery({
    ...childNodesQueryOptions(apiClient, rootParentId),
    enabled: phase === "form" && kind === "city" && !!rootParentId,
  });

  const { data: preflight } = useQuery({
    ...bindingPreflightQueryOptions(apiClient, hostname),
    enabled: phase === "form" && !!slug,
  });

  const orgMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.create({ name: orgName, slug: orgSlug });
      if (error) throw new Error(error.message);

      const { data: session, error: sessionError } = await auth.getSession({
        query: { disableCookieCache: true },
      });
      if (sessionError || !session) {
        throw new Error(
          `Organization created, but the session could not be refreshed: ${sessionError?.message ?? "no active session returned"}`,
        );
      }
      return session;
    },
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey, refetchType: "none" });
      queryClient.setQueryData(sessionQueryKey, session);
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.invalidate();
      toast.success("Organization submitted for approval");
      await router.navigate({ to: "/orgs" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to create organization"),
  });

  const submitMutation = useMutation({
    mutationFn: async (values: TenantWizardValues) => {
      if (!gatewayId) {
        throw new Error(
          "Runtime configuration is missing the gateway id — this deployment is misconfigured",
        );
      }
      const daoAccountId = daoConnection.daoAccountId;
      if (!daoAccountId) throw new Error("Connect a DAO account first");

      return createTenantResources({
        apiClient,
        values,
        daoAccountId,
        gatewayId,
        onStep: (state, error) => stepper.updateStep(0, state, error),
        onTenantCreated: setCreatedTenantId,
      });
    },
    onSuccess: async () => {
      await Promise.all([invalidateNodeQueries(queryClient), invalidateTenantQueries(queryClient)]);
      await router.invalidate({ sync: true });
      setPhase("deploy");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Failed to create tenant — rolled back"),
  });

  const deployPublish = useMutation({
    mutationFn: async () => {
      if (!createdTenantId) throw new Error("Tenant not created yet");
      if (!gatewayId) {
        throw new Error(
          "Runtime configuration is missing the gateway id — this deployment is misconfigured",
        );
      }
      const daoAccountId = daoConnection.daoAccountId;
      if (!daoAccountId) throw new Error("Disconnect detected — reconnect and retry");

      stepper.updateStep(1, "running");

      try {
        await publishDaoTenantConfig(apiClient, {
          daoAccountId,
          gatewayId,
          baseAccount,
          hostname,
          title: tenantName || name,
        });
        stepper.updateStep(1, "success");
        return true;
      } catch (err) {
        stepper.updateStep(1, "failed", err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    onSuccess: () => toast.success("Config submitted to DAO"),
    onError: (error: Error) => toast.error(error.message || "Failed to submit config"),
  });

  async function recheckPublish() {
    if (!daoConnection.daoAccountId) return;
    if (!gatewayId) {
      setVerifyState("failed");
      setVerifyMessage(
        "Runtime configuration is missing the gateway id — this deployment is misconfigured",
      );
      return;
    }
    setVerifyState("checking");
    setVerifyMessage(null);
    try {
      const ok = await fastKvAccountHasConfig(daoConnection.daoAccountId, gatewayId);
      if (ok) {
        setVerifyState("verified");
        return;
      }
      setVerifyState("failed");
      setVerifyMessage("config not yet published — approve in Trezu if pending");
    } catch (err) {
      setVerifyState("failed");
      setVerifyMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const formValuesValid = tenantWizardSchema.safeParse(formValues).success;
  const daoReady = daoConnection.status === "connected" && !!daoConnection.daoAccountId;
  const hostnameAvailable = preflight?.hostname.available !== false;
  const canContinueDetails = formValuesValid && hostnameAvailable;
  const canSubmitDuringForm =
    hasOrg && formValuesValid && hostnameAvailable && daoReady && activeNetwork === "mainnet";
  const blockedReason =
    activeNetwork !== "mainnet"
      ? "Switch to mainnet to create this tenant."
      : !hostnameAvailable
        ? `${hostname} is already taken.`
        : null;
  const parentNode = [...rootNodes, ...stateNodes].find((node) => node.id === formValues.parentId);
  const parentName = kind === "country" ? null : (parentNode?.name ?? null);

  if (phase === "deploy") {
    return (
      <TenantDeployPhase
        steps={stepper.steps}
        verifyState={verifyState}
        verifyMessage={verifyMessage}
        hostname={hostname}
        daoAccountId={daoConnection.daoAccountId}
        createdTenantId={createdTenantId}
        tenantSlug={slug}
        publishPending={deployPublish.isPending}
        allDone={stepper.steps.every((step) => step.state === "success")}
        onRecheck={() => void recheckPublish()}
        onSubmitPublish={() => deployPublish.mutate()}
        onResetPublish={() => {
          stepper.updateStep(1, "pending");
          deployPublish.reset();
        }}
      />
    );
  }

  return (
    <TenantCreationStage
      activeNetwork={activeNetwork}
      organization={{
        hasOrg,
        gate: {
          orgName,
          orgSlug,
          orgSlugManuallyEdited,
          isPending: orgMutation.isPending,
          onOrgNameChange: setOrgName,
          onOrgSlugChange: setOrgSlug,
          onSubmit: () => orgMutation.mutate(),
        },
      }}
      dao={{
        ready: daoReady,
        accountId: daoConnection.daoAccountId,
        onChange: () => void disconnectDaoAccount(),
      }}
      details={{
        confirmed: detailsConfirmed && canContinueDetails,
        summary: [name, humanize(kind), hostname].filter(Boolean).join(" · "),
        onEdit: () => setDetailsConfirmed(false),
        form,
        kind,
        rootNodes,
        stateNodes,
        rootParentId,
        setRootParentId,
        slugManuallyEdited,
        tenantNameManuallyEdited,
        hostname,
        preflight,
        canContinue: canContinueDetails,
        onContinue: () => setDetailsConfirmed(true),
      }}
      review={{
        summary: {
          name,
          kind,
          parentName,
          tenantName: tenantName || name,
          hostname,
          daoAccountId: daoConnection.daoAccountId,
        },
        baseAccount,
        gatewayId,
        submitPending: submitMutation.isPending,
        canSubmit: canSubmitDuringForm,
        blockedReason,
        onSubmit: (event) => {
          event.preventDefault();
          void form.handleSubmit();
        },
      }}
    />
  );
}
