import { ArrowLeftIcon, ArrowUpIcon, ClockIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { useApiClient } from "@/app";
import { Badge, Button, EmptyState, PageContainer, PageHeader } from "@/components";
import { ThingContent } from "./-thing-content";
import { type ThingProposal, ThingProposalStatus } from "./-thing-proposal-status";

type ApiClient = ReturnType<typeof useApiClient>;
type Thing = NonNullable<Awaited<ReturnType<ApiClient["template"]["getThing"]>>>;
type UpvoteCount = Awaited<ReturnType<ApiClient["votes"]["getUpvoteCount"]>>;
type UserVote = Awaited<ReturnType<ApiClient["votes"]["getUserVote"]>>;

export function ThingBackLink({ canGoBack, onBack }: { canGoBack: boolean; onBack: () => void }) {
  return canGoBack ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-3 self-start"
      onClick={onBack}
      data-testid="thing-back"
    >
      <ArrowLeftIcon />
      Things
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 self-start"
      nativeButton={false}
      render={<Link to="/things" />}
      data-testid="thing-back"
    >
      <ArrowLeftIcon />
      Things
    </Button>
  );
}

export function ThingDetailsView({
  canGoBack,
  isAdmin,
  isDeletePending,
  isVoteLoading,
  isVotePending,
  proposal,
  thing,
  thingId,
  upvoteCount,
  userVote,
  onBack,
  onDelete,
  onVote,
}: {
  canGoBack: boolean;
  isAdmin: boolean;
  isDeletePending: boolean;
  isVoteLoading: boolean;
  isVotePending: boolean;
  proposal: ThingProposal | null | undefined;
  thing: Thing | undefined;
  thingId: string;
  upvoteCount: UpvoteCount | undefined;
  userVote: UserVote | undefined;
  onBack: () => void;
  onDelete: () => void;
  onVote: (nextHasUpvote: boolean) => void;
}) {
  const hasUpvote = userVote?.hasUpvote ?? false;

  return (
    <PageContainer variant="default">
      <div className="flex flex-col gap-4">
        <ThingBackLink canGoBack={canGoBack} onBack={onBack} />
        <PageHeader
          title={<span className="block font-mono break-all">{thingId}</span>}
          headerTestId="thing.heading"
          actions={
            thing ? (
              <Button
                type="button"
                variant={hasUpvote ? "default" : "outline"}
                className="w-full sm:w-auto"
                aria-pressed={hasUpvote}
                onClick={() => onVote(!hasUpvote)}
                disabled={isVoteLoading || isVotePending}
                data-testid="thing-upvote"
              >
                <ArrowUpIcon />
                <span className="tabular-nums">{upvoteCount?.totalCount ?? 0}</span>
                <span>{hasUpvote ? "upvoted" : "upvote"}</span>
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          {thing && (
            <Badge variant="outline" className="font-mono">
              {thing.type}
            </Badge>
          )}
          {proposal && <ThingProposalStatus proposal={proposal} />}
        </div>
      </div>

      {thing ? (
        <ThingContent
          thing={thing}
          isAdmin={isAdmin}
          isDeletePending={isDeletePending}
          onDelete={onDelete}
        />
      ) : (
        <EmptyState
          icon={ClockIcon}
          title="Not live yet"
          description="This thing is not live in the registry yet."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/things/new" />}>
              Propose another
            </Button>
          }
        />
      )}
    </PageContainer>
  );
}
