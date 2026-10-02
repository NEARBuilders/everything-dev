import { GavelIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getAccount, getGatewayId, useApiClient } from "@/app";
import { Button, Card, CardContent, EmptyState, PageHeader, Skeleton } from "@/components";
import { useDaoConnection } from "@/lib/dao-connect";
import { pageTitle } from "@/lib/page-title";
import { invalidateNodeQueries } from "@/lib/queries/nodes";
import { invalidateTenantQueries } from "@/lib/queries/tenants";
import { publishDaoTenantConfig } from "@/lib/tenant-deploy";
import { nodeProposalPayloadSchema } from "@/routes/_authenticated/_dashboard/-node-application";
import { BackLink } from "../-admin-ui";
import { approveAndApplyProposal } from "./-proposal-application";
import type { Proposal } from "./-proposal-columns";
import {
  adminProposalDetailQueryOptions,
  proposalReviewHistoryQueryOptions,
  proposalReviewQueryKeys,
  proposalTitle,
  proposalTypeLabel,
} from "./-proposal-review";
import { ProposalReviewActions } from "./-proposal-review-actions";
import { ProposalReviewHistory } from "./-proposal-review-history";
import {
  ProposalDetails,
  ProposalOutcome,
  ProposalStatusBadges,
  ProposalSubject,
} from "./-proposal-summary";

type ProposalDetailSearch = { pluginId?: string; entityId?: string };

export const Route = createFileRoute("/_admin/_dashboard/admin/proposals/$proposalId")({
  validateSearch: (search: Record<string, unknown>): ProposalDetailSearch => ({
    pluginId: typeof search.pluginId === "string" ? search.pluginId : undefined,
    entityId: typeof search.entityId === "string" ? search.entityId : undefined,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Proposal · Admin", match.context.runtimeConfig) }],
  }),
  component: ProposalDetailPage,
});

function ProposalDetailPage() {
  const { proposalId } = Route.useParams();
  const { pluginId, entityId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { runtimeConfig } = Route.useRouteContext();
  const gatewayId = getGatewayId(runtimeConfig);
  const baseAccount = getAccount(runtimeConfig);
  const daoConnection = useDaoConnection();
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifiedDaoAccountId, setVerifiedDaoAccountId] = useState<string | null>(null);
  const handleDaoVerified = useCallback(
    ({ daoAccountId }: { daoAccountId: string }) => setVerifiedDaoAccountId(daoAccountId),
    [],
  );
  const proposalQueryKey = proposalReviewQueryKeys.detail(proposalId, pluginId, entityId);
  const proposalQuery = useQuery(
    adminProposalDetailQueryOptions(apiClient, proposalId, pluginId, entityId),
  );
  const reviewHistoryQuery = useQuery(proposalReviewHistoryQueryOptions(apiClient, pluginId));

  useEffect(() => {
    if (verifiedDaoAccountId && verifiedDaoAccountId !== daoConnection.daoAccountId) {
      setVerifiedDaoAccountId(null);
    }
  }, [daoConnection.daoAccountId, verifiedDaoAccountId]);

  const reviewMutation = useMutation({
    mutationFn: async ({
      proposal,
      action,
      reason,
    }: {
      proposal: Proposal;
      action: "approve" | "reject";
      reason?: string;
    }) => {
      if (!gatewayId) {
        throw new Error(
          "Runtime configuration is missing the gateway id — this deployment is misconfigured",
        );
      }
      if (action === "reject") {
        const rejected = await apiClient.proposals.reject({
          pluginId: proposal.pluginId,
          entityId: proposal.entityId,
          expectedUpdatedAt: proposal.updatedAt,
          reason: reason?.trim() ?? "",
        });
        return { action, proposal: rejected.data };
      }

      if (proposal.pluginId === "node") {
        const payload = nodeProposalPayloadSchema.parse(proposal.payload);
        if (
          !daoConnection.daoAccountId ||
          daoConnection.daoAccountId !== payload.accountId ||
          verifiedDaoAccountId !== payload.accountId
        ) {
          throw new Error(`Connect and verify ${payload.accountId} through Trezu before approval`);
        }
      }

      const reviewedProposal = await approveAndApplyProposal({
        apiClient,
        proposal,
        gatewayId,
        baseAccount,
        publishTenantConfig: (input) => publishDaoTenantConfig(apiClient, input),
        onProposalChange: (nextProposal) =>
          queryClient.setQueryData(proposalQueryKey, nextProposal),
      });
      return { action, proposal: reviewedProposal };
    },
    onSuccess: async ({ action, proposal }) => {
      toast.success(
        action === "reject"
          ? "Proposal rejected"
          : proposal.applyStatus === "applied"
            ? "Proposal approved and resource created"
            : "Proposal approved",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: proposalReviewQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["thing-proposal", proposal.entityId] }),
        queryClient.invalidateQueries({ queryKey: ["thing", proposal.entityId] }),
        queryClient.invalidateQueries({ queryKey: ["things-list"] }),
        queryClient.invalidateQueries({ queryKey: proposalReviewQueryKeys.histories() }),
        invalidateNodeQueries(queryClient),
        invalidateTenantQueries(queryClient),
      ]);
      await navigate({ to: "/admin/proposals" });
    },
    onError: async (error: Error) => {
      toast.error(error.message || "Failed to review proposal");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: proposalQueryKey }),
        queryClient.invalidateQueries({ queryKey: proposalReviewQueryKeys.all }),
      ]);
    },
  });

  if (!pluginId || !entityId) {
    return (
      <EmptyState
        icon={GavelIcon}
        title="Open this proposal from the list"
        description="The link is missing the details needed to find it."
        action={
          <Button variant="outline" nativeButton={false} render={<Link to="/admin/proposals" />}>
            Back to proposals
          </Button>
        }
      />
    );
  }

  if (proposalQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (proposalQuery.isError || !proposalQuery.data) {
    return (
      <EmptyState
        icon={GavelIcon}
        title="Proposal not found"
        description={proposalQuery.error?.message || "This proposal is no longer available."}
        action={
          <Button variant="outline" nativeButton={false} render={<Link to="/admin/proposals" />}>
            Back to proposals
          </Button>
        }
      />
    );
  }

  const proposal = proposalQuery.data;
  const isPending = proposal.reviewStatus === "pending";
  const parsedNodePayload =
    proposal.pluginId === "node" ? nodeProposalPayloadSchema.safeParse(proposal.payload) : null;
  const proposalDaoAccountId = parsedNodePayload?.success ? parsedNodePayload.data.accountId : null;
  const daoIsVerified =
    proposal.pluginId !== "node" ||
    (!!proposalDaoAccountId &&
      daoConnection.daoAccountId === proposalDaoAccountId &&
      verifiedDaoAccountId === proposalDaoAccountId);

  return (
    <>
      <PageHeader
        label={<BackLink to="/admin/proposals">Proposals</BackLink>}
        title={proposalTitle(proposal)}
        description={`${proposalTypeLabel(proposal.pluginId)} · ${proposal.entityId}`}
        actions={<ProposalStatusBadges proposal={proposal} />}
        headerTestId="admin-proposal.heading"
      />

      <div className="grid gap-12 lg:grid-cols-3 lg:gap-10">
        <div className="flex min-w-0 flex-col gap-12 lg:col-span-2">
          <ProposalSubject proposal={proposal} />
          <ProposalDetails proposal={proposal} />
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardContent className="p-5 sm:p-6">
              {isPending ? (
                <ProposalReviewActions
                  isPending={isPending}
                  isNodeProposal={proposal.pluginId === "node"}
                  proposalDaoAccountId={proposalDaoAccountId}
                  daoIsVerified={daoIsVerified}
                  rejectionReason={rejectionReason}
                  isReviewing={reviewMutation.isPending}
                  onDaoVerified={handleDaoVerified}
                  onRejectionReasonChange={(event) => setRejectionReason(event.target.value)}
                  onApprove={() => reviewMutation.mutate({ proposal, action: "approve" })}
                  onReject={() =>
                    reviewMutation.mutate({
                      proposal,
                      action: "reject",
                      reason: rejectionReason.trim(),
                    })
                  }
                />
              ) : (
                <ProposalOutcome proposal={proposal} />
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      <ProposalReviewHistory pluginId={pluginId} query={reviewHistoryQuery} />
    </>
  );
}
