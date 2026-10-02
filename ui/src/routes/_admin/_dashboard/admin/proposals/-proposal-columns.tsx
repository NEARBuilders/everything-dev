import { Link } from "@tanstack/react-router";
import type { useApiClient } from "@/app";
import { Badge, Button, LocalDate } from "@/components";
import type { DataTableColumnDef } from "@/components/data-table";
import { humanize } from "../-admin-ui";
import { proposalReviewStatusVariant, proposalTitle, proposalTypeLabel } from "./-proposal-review";

type ApiClient = ReturnType<typeof useApiClient>;
type ProposalResult = Awaited<ReturnType<ApiClient["proposals"]["getProposals"]>>;
export type Proposal = ProposalResult["data"][number];

export function ProposalLink({ proposal, className }: { proposal: Proposal; className?: string }) {
  return (
    <Link
      to="/admin/proposals/$proposalId"
      params={{ proposalId: proposal.id }}
      search={{ pluginId: proposal.pluginId, entityId: proposal.entityId }}
      className={className}
    >
      {proposalTitle(proposal)}
    </Link>
  );
}

export function createProposalColumns(): DataTableColumnDef<Proposal>[] {
  return [
    {
      id: "title",
      accessorFn: (row) => proposalTitle(row),
      header: "Proposal",
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <ProposalLink proposal={row.original} className="font-medium hover:underline" />
          <span className="block max-w-56 truncate font-mono text-xs text-muted-foreground">
            {row.original.entityId}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "pluginId",
      header: "Type",
      meta: { className: "hidden lg:table-cell" },

      cell: ({ row }) => (
        <span className="text-muted-foreground">{proposalTypeLabel(row.original.pluginId)}</span>
      ),
    },
    {
      accessorKey: "createdBy",
      header: "Submitted by",
      meta: { className: "hidden lg:table-cell" },

      cell: ({ row }) => (
        <span className="block max-w-44 truncate font-mono text-xs text-muted-foreground">
          {row.original.createdBy}
        </span>
      ),
    },
    {
      accessorKey: "reviewStatus",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={proposalReviewStatusVariant(row.original.reviewStatus)}>
          {humanize(row.original.reviewStatus)}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Submitted",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          <LocalDate value={row.original.createdAt} format="relative" />
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant={row.original.reviewStatus === "pending" ? "outline" : "ghost"}
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/admin/proposals/$proposalId"
              params={{ proposalId: row.original.id }}
              search={{ pluginId: row.original.pluginId, entityId: row.original.entityId }}
            />
          }
        >
          {row.original.reviewStatus === "pending" ? "Review" : "View"}
        </Button>
      ),
    },
  ];
}
