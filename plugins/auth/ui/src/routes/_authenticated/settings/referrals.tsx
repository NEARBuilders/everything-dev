import {
  ChatCircleDotsIcon,
  CopyIcon,
  GiftIcon,
  LinkIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  type ReferralDashboard,
  type ReferralListResult,
  sessionQueryOptions,
  useAuthClient,
} from "everything-dev/ui/auth";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/settings/referrals")({
  head: () => ({
    meta: [
      { title: "Referrals · Settings" },
      { name: "description", content: "Share your referral link and track who joined." },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
  },
  component: ReferralsSettings,
});

const REFERRALS_PAGE_SIZE = 20;

async function copyText(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Failed to copy");
  }
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-2xl border border-border px-4 py-3"
      data-testid={testId}
    >
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function ReferralsSettings() {
  const auth = useAuthClient();
  const [page, setPage] = useState(0);
  const offset = page * REFERRALS_PAGE_SIZE;

  const dashboardQuery = useQuery({
    queryKey: ["referral-dashboard"],
    queryFn: async (): Promise<ReferralDashboard> => {
      const { data, error } = await auth.referrals.dashboard();
      if (error) throw new Error(error.message ?? "Could not load your referral code");
      return data;
    },
  });

  const referralsQuery = useQuery({
    queryKey: ["referral-list", offset],
    queryFn: async (): Promise<ReferralListResult> => {
      const { data, error } = await auth.referrals.list({
        limit: REFERRALS_PAGE_SIZE,
        offset,
      });
      if (error) throw new Error(error.message ?? "Could not load your referrals");
      return data;
    },
  });

  const code = dashboardQuery.data?.code;
  const shareLink = code ? `${window.location.origin}/login?ref=${code}` : null;
  const referrals = referralsQuery.data?.referrals ?? [];
  const total = referralsQuery.data?.total ?? 0;
  const hasPrev = page > 0;
  const hasNext = offset + referrals.length < total;

  if (dashboardQuery.isPending) {
    return (
      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Referrals"
          description="Invite people and track who joined with your link."
          sectionTestId="referrals.heading"
        />
        <div className="flex flex-col gap-4" data-testid="referrals.loading">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      </section>
    );
  }

  if (dashboardQuery.isError || !code) {
    return (
      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Referrals"
          description="Invite people and track who joined with your link."
          sectionTestId="referrals.heading"
        />
        <EmptyState
          icon={WarningCircleIcon}
          title="Couldn't load your referrals"
          description="Check your connection and try again."
          action={
            <Button
              variant="outline"
              onClick={() => void dashboardQuery.refetch()}
              data-testid="referrals.retry-button"
            >
              Try again
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Referrals"
        description="Invite people and track who joined with your link."
        sectionTestId="referrals.heading"
      />

      <ItemGroup>
        <Item variant="outline" size="sm">
          <ItemMedia variant="icon">
            <GiftIcon />
          </ItemMedia>
          <ItemContent className="basis-0">
            <ItemTitle>
              <span className="font-mono" data-testid="referrals.code">
                {code}
              </span>
            </ItemTitle>
            <ItemDescription>Your referral code — share your invite link below.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy referral code"
              data-testid="referrals.copy-code"
              onClick={() => void copyText(code, "Referral code copied")}
            >
              <CopyIcon />
            </Button>
          </ItemActions>
        </Item>
        {shareLink && (
          <Item variant="outline" size="sm">
            <ItemMedia variant="icon">
              <LinkIcon />
            </ItemMedia>
            <ItemContent className="basis-0">
              <ItemTitle>
                <span className="min-w-0 truncate font-mono" data-testid="referrals.share-link">
                  {shareLink}
                </span>
              </ItemTitle>
              <ItemDescription>
                Anyone signing in through this link counts as your referral.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Copy invite link"
                data-testid="referrals.copy-link"
                onClick={() => void copyText(shareLink, "Invite link copied")}
              >
                <CopyIcon />
              </Button>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total"
          value={dashboardQuery.data?.stats.total ?? 0}
          testId="referrals.stat-total"
        />
        <Stat
          label="Completed"
          value={dashboardQuery.data?.stats.completed ?? 0}
          testId="referrals.stat-completed"
        />
        <Stat
          label="Pending"
          value={dashboardQuery.data?.stats.pending ?? 0}
          testId="referrals.stat-pending"
        />
        <Stat
          label="Joined today"
          value={dashboardQuery.data?.stats.joinedToday ?? 0}
          testId="referrals.stat-joined-today"
        />
      </div>

      {referralsQuery.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : referralsQuery.isError ? (
        <EmptyState
          icon={WarningCircleIcon}
          title="Couldn't load your referrals"
          description="Check your connection and try again."
          action={
            <Button
              variant="outline"
              onClick={() => void referralsQuery.refetch()}
              data-testid="referrals.retry-button"
            >
              Try again
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon={ChatCircleDotsIcon}
          title="No referrals yet"
          description="Share your invite link — people who sign in through it show up here."
        />
      ) : (
        <>
          <ItemGroup data-testid="referrals.list">
            {referrals.map((referral) => (
              <Item key={referral.id} variant="outline" size="sm" role="listitem">
                <ItemMedia variant="icon">
                  <GiftIcon />
                </ItemMedia>
                <ItemContent className="basis-0">
                  <ItemTitle className="max-w-full">
                    <span className="min-w-0 truncate">
                      {referral.referredUser.name || referral.referredUser.email}
                    </span>
                  </ItemTitle>
                  <ItemDescription>
                    <span
                      className={
                        referral.status === "completed"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {referral.status === "completed" ? "Completed" : "Pending"}
                    </span>
                    {" · "}
                    Joined <LocalDate value={referral.createdAt} format="relative" />
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
          {(hasPrev || hasNext) && (
            <div className="flex items-center justify-between" data-testid="referrals.pagination">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                data-testid="referrals.prev-page"
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                {offset + 1}–{offset + referrals.length} of {total}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage((current) => current + 1)}
                data-testid="referrals.next-page"
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
