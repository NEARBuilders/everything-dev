import type { useApiClient } from "@/app";
import { Badge } from "@/components";

type ApiClient = ReturnType<typeof useApiClient>;
export type ThingProposal = Awaited<
  ReturnType<ApiClient["proposals"]["getProposals"]>
>["data"][number];

type BadgeVariant = "success" | "warning" | "destructive" | "secondary";

export type ThingProposalStatusContent = {
  title: string;
  description: string;
  variant: BadgeVariant;
};

export function getThingProposalStatusContent(proposal: ThingProposal): ThingProposalStatusContent {
  if (proposal.reviewStatus === "pending") {
    return {
      title: "Pending review",
      description: "An admin must approve this proposal before the thing goes live.",
      variant: "warning",
    };
  }
  if (proposal.reviewStatus === "approved") {
    if (proposal.applyStatus === "applied") {
      return {
        title: "Approved",
        description: "Approved and live in the thing registry.",
        variant: "success",
      };
    }
    if (proposal.applyStatus === "failed") {
      return {
        title: "Apply failed",
        description: `Approved, but applying it failed${proposal.applyError ? `: ${proposal.applyError}` : "."}`,
        variant: "destructive",
      };
    }
    return {
      title: "Approved · applying",
      description: "Approved and being applied to the thing registry.",
      variant: "success",
    };
  }
  if (proposal.reviewStatus === "rejected") {
    return {
      title: "Rejected",
      description: proposal.rejectionReason || "This proposal was not approved.",
      variant: "destructive",
    };
  }
  return {
    title: "Removed",
    description: "This proposal is no longer active.",
    variant: "secondary",
  };
}

export function ThingProposalStatus({ proposal }: { proposal: ThingProposal }) {
  const content = getThingProposalStatusContent(proposal);

  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="thing-proposal-status">
      <Badge variant={content.variant}>{content.title}</Badge>
      <span className="text-sm text-muted-foreground">{content.description}</span>
    </div>
  );
}
