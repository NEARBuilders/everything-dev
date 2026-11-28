import {
  ArrowsClockwiseIcon,
  EnvelopeSimpleIcon,
  WalletIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { createDataTableColumnHelper, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InviteMemberForm } from "./invite-member-form";
import { roleLabel } from "./org-avatar";
import { RowMenu } from "./row-menu";
import type { InvitationRow } from "./types";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useOrgWorkspace } from "./workspace-context";

const columnHelper = createDataTableColumnHelper<InvitationRow>();

const STATUS_VARIANT = {
  pending: "secondary",
  accepted: "success",
} as const;

export function OrgInvitationsPage() {
  const { snapshot, canManage, adapter, isPersonal } = useOrgWorkspace();
  const actions = useWorkspaceActions();
  const [search, setSearch] = useState("");
  const teamNames = useMemo(
    () => new Map(snapshot.teams.map((team) => [team.id, team.name])),
    [snapshot.teams],
  );
  const canAct = canManage && adapter.capabilities.manageInvitations;

  const columns = useMemo(
    () => [
      columnHelper.accessor((invitation) => invitation.nearAccountId ?? invitation.email ?? "", {
        id: "invitee",
        header: "Invitee",
        sortFn: "text",
        cell: ({ row }) => {
          const invitation = row.original;
          const identifier = invitation.nearAccountId ?? invitation.email ?? "email invitation";
          const needsReissue = !!invitation.nearAccountId && !invitation.nearNetwork;
          return (
            <div className="flex min-w-0 items-center gap-2">
              {invitation.nearAccountId ? (
                <WalletIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <EnvelopeSimpleIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex min-w-0 flex-col">
                <span className="break-all">{identifier}</span>
                {invitation.nearAccountId && (
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`invitation-network-${invitation.id}`}
                  >
                    {needsReissue
                      ? "Network unknown. Cancel and reissue with an explicit network."
                      : invitation.nearNetwork}
                  </span>
                )}
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor((invitation) => invitation.role ?? "member", {
        id: "role",
        header: "Role",
        sortFn: "text",
        cell: ({ row }) => <Badge variant="outline">{roleLabel(row.original.role)}</Badge>,
      }),
      columnHelper.accessor((invitation) => teamNames.get(invitation.teamId ?? "") ?? "", {
        id: "team",
        header: "Team",
        sortFn: "text",
        cell: ({ row }) => (
          <span data-testid={`invitation-team-${row.original.id}`}>
            {teamNames.get(row.original.teamId ?? "") ?? (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        sortFn: "text",
        cell: ({ row }) => (
          <Badge
            variant={
              STATUS_VARIANT[row.original.status as keyof typeof STATUS_VARIANT] ?? "outline"
            }
          >
            {roleLabel(row.original.status)}
          </Badge>
        ),
      }),
      columnHelper.accessor((invitation) => new Date(invitation.expiresAt).getTime(), {
        id: "expires",
        header: "Expires",
        sortFn: "alphanumeric",
        cell: ({ row }) => <LocalDate value={row.original.expiresAt} format="relative" />,
      }),
      ...(canAct
        ? [
            columnHelper.display({
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              cell: ({ row }) => {
                const invitation = row.original;
                if (invitation.status !== "pending") return null;
                const needsReissue = !!invitation.nearAccountId && !invitation.nearNetwork;
                return (
                  <div className="flex justify-end">
                    <RowMenu label="Invitation actions" testId={`invitation-menu-${invitation.id}`}>
                      {!needsReissue && (
                        <DropdownMenuItem
                          onClick={() => actions.resendInvitation.mutate(invitation)}
                          disabled={actions.resendInvitation.isPending}
                        >
                          <ArrowsClockwiseIcon />
                          Resend
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => actions.cancelInvitation.mutate(invitation.id)}
                        disabled={actions.cancelInvitation.isPending}
                      >
                        <XCircleIcon />
                        Cancel invitation
                      </DropdownMenuItem>
                    </RowMenu>
                  </div>
                );
              },
            }),
          ]
        : []),
    ],
    [canAct, teamNames, actions.resendInvitation, actions.cancelInvitation],
  );

  return (
    <section className="flex flex-col gap-6" data-testid="org-invitations">
      {adapter.capabilities.invite && canManage && !isPersonal && (
        <div className="flex flex-col gap-3">
          <SectionHeader title="Invite someone" />
          <InviteMemberForm
            isPending={actions.inviteMember.isPending}
            onInvite={(values) => actions.inviteMember.mutateAsync(values)}
            teams={snapshot.teams}
          />
        </div>
      )}
      <div className="flex flex-col gap-4">
        <SectionHeader title="Invitations" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search invitations"
          className="max-w-xs"
          data-testid="org-invitations-search"
        />
        <DataTable
          testId="org-invitations-table"
          columns={columns}
          data={snapshot.invitations}
          getRowId={(invitation) => invitation.id}
          search={search}
          empty={
            <EmptyState
              icon={EnvelopeSimpleIcon}
              title="No invitations"
              description="Invitations you send show up here."
            />
          }
        />
      </div>
    </section>
  );
}
