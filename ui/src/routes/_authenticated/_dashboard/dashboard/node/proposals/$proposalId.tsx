import { ArrowLeftIcon, SealCheckIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useApiClient } from "@/app";
import { Badge, Button, EmptyState, LocalDate, SectionHeader, Skeleton } from "@/components";
import { nodeProposalsQueryOptions } from "./-node-proposals-query";
import { applyStatusLabel, proposalTitle, reviewStatusBadge } from "./-proposal-summary";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/dashboard/node/proposals/$proposalId",
)({
  component: NodeProposalDetail,
});

function NodeProposalDetail() {
  const apiClient = useApiClient();
  const { proposalId } = Route.useParams();
  const { selectedNode } = Route.useRouteContext();
  const nodeId = selectedNode?.id ?? "";
  const proposalsQuery = useQuery(nodeProposalsQueryOptions(apiClient, nodeId));

  if (!selectedNode) return null;

  const proposal = proposalsQuery.data?.data.find((item) => item.id === proposalId);
  const back = (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 self-start"
      nativeButton={false}
      data-testid="dashboard-node.proposal-back"
      render={<Link to="/dashboard/node/proposals" search={{ nodeId }} />}
    >
      <ArrowLeftIcon />
      Proposals
    </Button>
  );

  if (proposalsQuery.isLoading) {
    return (
      <section className="flex flex-col gap-6" aria-busy="true">
        {back}
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </section>
    );
  }

  if (!proposal) {
    return (
      <section className="flex flex-col gap-6">
        {back}
        <EmptyState
          icon={SealCheckIcon}
          title={proposalsQuery.isError ? "Couldn't load this proposal" : "Proposal not found"}
          description={
            proposalsQuery.isError
              ? "Check your connection and try again."
              : `It isn't in ${selectedNode.name}'s proposals.`
          }
          action={
            proposalsQuery.isError ? (
              <Button variant="outline" onClick={() => proposalsQuery.refetch()}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </section>
    );
  }

  const badge = reviewStatusBadge(proposal.reviewStatus);
  const applied = applyStatusLabel(proposal.applyStatus);

  return (
    <section className="flex flex-col gap-6" data-testid="dashboard-node.proposal-detail">
      <div className="flex flex-col gap-3">
        {back}
        <SectionHeader
          title={proposalTitle(proposal.payload, "Proposal")}
          description={
            <>
              Submitted <LocalDate value={proposal.createdAt} format="datetime" />
              {proposal.rejectionReason ? ` · ${proposal.rejectionReason}` : ""}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {applied && <Badge variant="outline">{applied}</Badge>}
        </div>
      </div>
      <pre className="overflow-auto rounded-xl bg-muted p-4 font-mono text-xs">
        {JSON.stringify(proposal.payload, null, 2)}
      </pre>
    </section>
  );
}
