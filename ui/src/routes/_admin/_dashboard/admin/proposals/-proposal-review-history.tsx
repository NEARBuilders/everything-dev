import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiClient } from "@/app";
import { Button, EmptyState, SectionHeader } from "@/components";
import { ItemGroup } from "@/components/ui/item";
import { ListSkeleton } from "../-admin-ui";
import { proposalTypeLabel } from "./-proposal-review";
import { ReviewHistoryCard } from "./-review-history-card";

const HISTORY_PREVIEW = 8;

type ReviewHistoryResponse = Awaited<ReturnType<ApiClient["proposals"]["getReviewHistory"]>>;

export function ProposalReviewHistory({
  pluginId,
  query,
}: {
  pluginId: string;
  query: Pick<UseQueryResult<ReviewHistoryResponse>, "data" | "isLoading" | "isError" | "error">;
}) {
  const history = query.data?.data ?? [];
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Recent decisions"
        description={`${proposalTypeLabel(pluginId)} proposals`}
      />
      {query.isLoading ? (
        <ListSkeleton rows={2} />
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load decisions: {query.error?.message}
        </p>
      ) : history.length === 0 ? (
        <EmptyState
          icon={ClockCounterClockwiseIcon}
          title="No decisions yet"
          description="Approvals and rejections show up here."
          className="py-10"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ItemGroup>
            {(showAll ? history : history.slice(0, HISTORY_PREVIEW)).map((entry) => (
              <ReviewHistoryCard key={entry.id} entry={entry} />
            ))}
          </ItemGroup>
          {!showAll && history.length > HISTORY_PREVIEW && (
            <Button variant="ghost" className="self-center" onClick={() => setShowAll(true)}>
              Show all {history.length}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
