import { CaretRightIcon, GavelIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Badge, Button, EmptyState, LocalDate } from "@/components";
import { DataTable, type DataTableColumnDef } from "@/components/data-table";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { humanize, ListSkeleton } from "../-admin-ui";
import type { Proposal } from "./-proposal-columns";
import {
  type ProposalReviewFilter,
  proposalReviewStatusVariant,
  proposalTitle,
  proposalTypeLabel,
} from "./-proposal-review";

interface ProposalListStateProps {
  activeFilter: ProposalReviewFilter;
  columns: DataTableColumnDef<Proposal>[];
  proposals: Proposal[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function ProposalListState({
  activeFilter,
  columns,
  proposals,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: ProposalListStateProps) {
  if (isLoading) return <ListSkeleton />;

  if (isError) {
    return (
      <EmptyState
        icon={GavelIcon}
        title="Couldn't load proposals"
        description={errorMessage || "Something went wrong while loading proposals."}
        action={
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }

  if (proposals.length === 0) {
    return (
      <EmptyState
        icon={GavelIcon}
        title={activeFilter === "pending" ? "Nothing waiting for review" : "No proposals"}
        description={
          activeFilter === "all"
            ? "Community applications and submissions appear here."
            : `There are no ${activeFilter} proposals.`
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden md:block" data-testid="admin-proposals-table">
        <DataTable columns={columns} data={proposals} />
      </div>
      <ItemGroup className="md:hidden" data-testid="admin-proposals-rows">
        {proposals.map((proposal) => (
          <Item
            key={proposal.id}
            variant="outline"
            render={
              <Link
                to="/admin/proposals/$proposalId"
                params={{ proposalId: proposal.id }}
                search={{ pluginId: proposal.pluginId, entityId: proposal.entityId }}
              />
            }
          >
            <ItemContent className="min-w-0">
              <ItemTitle className="max-w-full">
                <span className="min-w-0 truncate">{proposalTitle(proposal)}</span>
              </ItemTitle>
              <ItemDescription>
                {proposalTypeLabel(proposal.pluginId)} ·{" "}
                <LocalDate value={proposal.createdAt} format="relative" />
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={proposalReviewStatusVariant(proposal.reviewStatus)}>
                {humanize(proposal.reviewStatus)}
              </Badge>
              <CaretRightIcon className="size-4 text-muted-foreground" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {hasNextPage && (
        <Button
          variant="outline"
          className="w-full sm:w-auto sm:self-center"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
