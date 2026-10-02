import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getGatewayId, useApiClient } from "@/app";
import { PageContainer, PageHeader } from "@/components";
import { useSwitchOrganization } from "@/components/layout/use-switch-organization";
import { FieldGroup } from "@/components/ui/field";
import { useAppTranslation } from "@/i18n/runtime";
import { useDaoConnection } from "@/lib/dao-connect";
import { pageTitle } from "@/lib/page-title";
import { childNodesQueryOptions, rootNodesQueryOptions } from "@/lib/queries/nodes";
import { organizationsQueryOptions } from "@/lib/queries/organizations";
import { invalidateProposalQueries } from "@/lib/queries/proposals";
import { bindingPreflightQueryOptions } from "@/lib/queries/tenants";
import { useNearAccount } from "@/lib/use-near-account";
import { ApplyApplicantFields } from "./-apply-applicant-fields";
import { type ApplyStepId, resolveApplySteps } from "./-apply-flow";
import { useApplicationForm } from "./-apply-form";
import { loadNodeApplicationParents } from "./-apply-loader";
import { ApplyNodeFields } from "./-apply-node-fields";
import { ApplyDaoStep, ApplyNearStep, ApplyOrganizationStep } from "./-apply-prerequisites";
import { ApplyStep } from "./-apply-step";
import { ApplySubmit } from "./-apply-submit";
import { ApplySubmitted } from "./-apply-submitted";
import {
  canSubmitNodeApplication,
  getDefaultOrganizationId,
  type NodeApplicationValues,
  proposeNodeApplication,
  resolveActiveOrganizationLabel,
} from "./-node-application";

export const Route = createFileRoute("/_authenticated/_dashboard/apply")({
  loader: ({ context }) =>
    loadNodeApplicationParents({
      apiClient: context.apiClient,
      queryClient: context.queryClient,
    }),
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Start a community", match.context.runtimeConfig) },
      { name: "description", content: "Apply to start a CityNode community." },
    ],
  }),
  component: ApplyPage,
});

function ApplyPage() {
  const t = useAppTranslation();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const initialRootNodes = Route.useLoaderData();
  const { auth, runtimeConfig } = Route.useRouteContext();
  const gatewayId = getGatewayId(runtimeConfig);
  const activeOrgId = auth.activeOrganizationId;
  const nearAccountId = useNearAccount();
  const daoConnection = useDaoConnection();
  const attemptedDefaultOrgId = useRef<string | null>(null);
  const slugManuallyEdited = useRef(false);
  const [rootParentId, setRootParentId] = useState(initialRootNodes[0]?.id ?? "");
  const [submittedProposalId, setSubmittedProposalId] = useState<string | null>(null);
  const [verifiedDaoAccountId, setVerifiedDaoAccountId] = useState<string | null>(null);
  const [reopenedStep, setReopenedStep] = useState<ApplyStepId | null>(null);
  const handleDaoVerified = useCallback(
    ({ daoAccountId }: { daoAccountId: string }) => setVerifiedDaoAccountId(daoAccountId),
    [],
  );

  const submitMutation = useMutation({
    mutationFn: async (values: NodeApplicationValues) => {
      if (!gatewayId) {
        throw new Error(t("apply.error.gateway"));
      }
      if (!activeOrgId) throw new Error(t("apply.error.organization"));
      if (!nearAccountId) throw new Error(t("apply.error.near"));
      if (!daoConnection.daoAccountId || verifiedDaoAccountId !== daoConnection.daoAccountId) {
        throw new Error(t("apply.error.dao"));
      }
      return proposeNodeApplication(apiClient, values, {
        orgId: activeOrgId,
        daoAccountId: daoConnection.daoAccountId,
        submitterAccountId: nearAccountId,
      });
    },
    onSuccess: async ({ data: proposal }) => {
      setSubmittedProposalId(proposal.id);
      toast.success(t("apply.success.title"), {
        description: t("apply.success.review"),
      });
      try {
        await invalidateProposalQueries(queryClient);
      } catch {
        toast.warning(t("apply.success.refresh"));
      }
    },
    onError: (error: Error) => toast.error(error.message || t("apply.error.submit")),
  });
  const form = useApplicationForm((values) => submitMutation.mutateAsync(values));
  const formValues = useSelector(form.store, (state) => state.values);
  const hostname = formValues.slug && gatewayId ? `${formValues.slug}.${gatewayId}` : "";

  const { data: queriedRootNodes } = useQuery(rootNodesQueryOptions(apiClient));
  const rootNodes = queriedRootNodes ?? initialRootNodes;
  const { data: organizations = [] } = useQuery(organizationsQueryOptions(apiClient));
  const defaultOrgId = getDefaultOrganizationId(activeOrgId, organizations);
  const switchOrganization = useSwitchOrganization();
  const displayedOrgId =
    activeOrgId ?? (switchOrganization.isError ? null : (defaultOrgId ?? null));
  const activeOrganizationLabel = resolveActiveOrganizationLabel(displayedOrgId, organizations);

  useEffect(() => {
    if (!defaultOrgId || attemptedDefaultOrgId.current === defaultOrgId) return;
    attemptedDefaultOrgId.current = defaultOrgId;
    switchOrganization.mutate(defaultOrgId);
  }, [defaultOrgId, switchOrganization.mutate]);
  useEffect(() => {
    if (verifiedDaoAccountId && verifiedDaoAccountId !== daoConnection.daoAccountId) {
      setVerifiedDaoAccountId(null);
    }
  }, [daoConnection.daoAccountId, verifiedDaoAccountId]);

  const { data: stateNodes = [], isLoading: statesLoading } = useQuery({
    ...childNodesQueryOptions(apiClient, rootParentId),
    enabled: formValues.kind === "city" && !!rootParentId,
  });
  const { data: preflight, isFetching: preflightLoading } = useQuery({
    ...bindingPreflightQueryOptions(apiClient, hostname),
    enabled: !!hostname,
  });

  const canSubmit = canSubmitNodeApplication({
    values: formValues,
    orgId: activeOrgId,
    daoAccountId:
      verifiedDaoAccountId === daoConnection.daoAccountId ? daoConnection.daoAccountId : null,
    submitterAccountId: nearAccountId,
    hostnameAvailable: preflight?.hostname.available === true,
    preflightLoading,
    submitting: submitMutation.isPending,
  });

  const orgDone = !!displayedOrgId && !!activeOrgId;
  const daoVerified =
    !!daoConnection.daoAccountId && verifiedDaoAccountId === daoConnection.daoAccountId;
  const steps = resolveApplySteps(
    { organization: orgDone, near: !!nearAccountId, dao: daoVerified },
    reopenedStep,
  );

  if (submittedProposalId) {
    return <ApplySubmitted proposalId={submittedProposalId} name={formValues.name.trim()} />;
  }

  return (
    <PageContainer variant="narrow">
      <PageHeader
        headerTestId="apply.heading"
        title={t("apply.title")}
        description={t("apply.progress", { step: steps.position })}
      />
      <ol className="flex flex-col" data-testid="apply.steps">
        <ApplyStep
          id="organization"
          number={1}
          title={t("apply.step.organization")}
          status={steps.status("organization")}
          summary={activeOrganizationLabel}
          onChange={() => setReopenedStep("organization")}
        >
          <ApplyOrganizationStep
            organizations={organizations}
            displayedOrgId={displayedOrgId}
            activating={!activeOrgId && !!defaultOrgId && !switchOrganization.isError}
            switching={switchOrganization.isPending}
            onSwitch={(organizationId) => switchOrganization.mutate(organizationId)}
            onContinue={() => setReopenedStep(null)}
          />
        </ApplyStep>
        <ApplyStep
          id="near"
          number={2}
          title={t("apply.step.near")}
          status={steps.status("near")}
          summary={nearAccountId}
        >
          <ApplyNearStep />
        </ApplyStep>
        <ApplyStep
          id="dao"
          number={3}
          title={t("apply.step.dao")}
          status={steps.status("dao")}
          summary={daoConnection.daoAccountId}
          onChange={() => setReopenedStep("dao")}
        >
          <ApplyDaoStep
            verified={daoVerified}
            onDaoVerified={handleDaoVerified}
            onContinue={() => setReopenedStep(null)}
          />
        </ApplyStep>
        <ApplyStep
          id="details"
          number={4}
          title={t("apply.step.details")}
          status={steps.status("details")}
          last
        >
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <ApplyNodeFields
                form={form}
                formValues={formValues}
                gatewayId={gatewayId}
                hostname={hostname}
                preflight={preflight}
                preflightLoading={preflightLoading}
                rootNodes={rootNodes}
                rootParentId={rootParentId}
                setRootParentId={setRootParentId}
                slugManuallyEdited={slugManuallyEdited}
                stateNodes={stateNodes}
                statesLoading={statesLoading}
              />
              <ApplyApplicantFields form={form} />
            </FieldGroup>
            <ApplySubmit canSubmit={canSubmit} isSubmitting={submitMutation.isPending} />
          </form>
        </ApplyStep>
      </ol>
    </PageContainer>
  );
}
