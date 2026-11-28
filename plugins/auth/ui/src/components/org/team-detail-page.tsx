import { ArrowLeftIcon, PencilSimpleIcon, TrashIcon, UserMinusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createDataTableColumnHelper, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { orgTeamMembersQueryKey } from "@/lib/org-query-keys";
import { AreaPicker } from "./area-picker";
import { MemberIdentity, memberDisplayName } from "./member-identity";
import { roleLabel } from "./org-avatar";
import { OrgLink } from "./org-link";
import { RowMenu } from "./row-menu";
import type { MemberRow, TeamMemberRow } from "./types";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useOrgWorkspace } from "./workspace-context";

const columnHelper = createDataTableColumnHelper<TeamMemberRow>();

export function OrgTeamDetailPage({ teamId }: { teamId: string }) {
  const { snapshot, adapter, canManage, mode, viewerUserId } = useOrgWorkspace();
  const actions = useWorkspaceActions();
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [deleting, setDeleting] = useState(false);

  const membersQuery = useQuery({
    queryKey: orgTeamMembersQueryKey(mode, teamId),
    queryFn: () => adapter.teamMembers(teamId),
    enabled: !!team,
    staleTime: 30 * 1000,
  });

  const orgMembersByUser = useMemo(
    () => new Map<string, MemberRow>(snapshot.members.map((member) => [member.userId, member])),
    [snapshot.members],
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (row) => memberDisplayName(orgMembersByUser.get(row.userId), row.userId),
        {
          id: "member",
          header: "Member",
          sortFn: "text",
          cell: ({ row }) => (
            <MemberIdentity
              member={orgMembersByUser.get(row.original.userId) ?? { userId: row.original.userId }}
              isSelf={row.original.userId === viewerUserId}
            />
          ),
        },
      ),
      columnHelper.accessor("role", {
        header: "Team role",
        sortFn: "text",
        cell: ({ row }) => <Badge variant="outline">{roleLabel(row.original.role)}</Badge>,
      }),
      columnHelper.accessor((row) => new Date(row.createdAt).getTime(), {
        id: "added",
        header: "Added",
        sortFn: "alphanumeric",
        cell: ({ row }) => <LocalDate value={row.original.createdAt} format="relative" />,
      }),
      ...(canManage
        ? [
            columnHelper.display({
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              cell: ({ row }) => (
                <div className="flex justify-end">
                  <RowMenu
                    label="Team member actions"
                    testId={`org-team-member-menu-${row.original.userId}`}
                  >
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        actions.removeTeamMember.mutate({ teamId, userId: row.original.userId })
                      }
                    >
                      <UserMinusIcon />
                      Remove from team
                    </DropdownMenuItem>
                  </RowMenu>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canManage, orgMembersByUser, teamId, viewerUserId, actions.removeTeamMember],
  );

  if (!team) {
    return (
      <EmptyState
        title="Team not found"
        description="It may have been deleted."
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={<OrgLink section={{ to: "teams" }} />}
          >
            Back to teams
          </Button>
        }
      />
    );
  }

  const teamMembers = membersQuery.data ?? [];
  const inTeam = new Set(teamMembers.map((member) => member.userId));
  const candidates = snapshot.members.filter((member) => !inTeam.has(member.userId));
  const candidateItems = candidates.map((member) => ({
    label: memberDisplayName(member, member.userId),
    value: member.userId,
  }));

  return (
    <section className="flex flex-col gap-8" data-testid="org-team-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<OrgLink section={{ to: "teams" }} />}
          data-testid="org-team-back"
        >
          <ArrowLeftIcon />
          All teams
        </Button>
        {canManage && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraftName(team.name);
                setRenaming(true);
              }}
              data-testid="org-team-rename"
            >
              <PencilSimpleIcon />
              Rename
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleting(true)}
              data-testid="org-team-delete"
            >
              <TrashIcon />
              Delete
            </Button>
          </div>
        )}
      </div>

      {renaming ? (
        <form
          className="flex max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = draftName.trim();
            if (!trimmed) return;
            actions.updateTeam.mutate(
              { teamId, name: trimmed },
              { onSuccess: () => setRenaming(false) },
            );
          }}
        >
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            aria-label="Team name"
            autoFocus
            data-testid="org-team-name-edit"
          />
          <Button type="submit" disabled={actions.updateTeam.isPending || !draftName.trim()}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <h2 className="text-2xl font-semibold wrap-anywhere" data-testid="org-team-title">
          {team.name}
        </h2>
      )}

      <div className="flex flex-col gap-4">
        <SectionHeader title="Access" />
        <AreaPicker
          value={team.areas}
          disabled={!canManage || actions.updateTeam.isPending}
          onChange={(areas) => actions.updateTeam.mutate({ teamId, areas })}
          testIdPrefix="org-team-area"
        />
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader
          title="Members"
          action={
            canManage ? (
              <div className="flex gap-2">
                <Select
                  value={selectedUserId}
                  items={candidateItems}
                  onValueChange={(value) => setSelectedUserId(value ?? "")}
                >
                  <SelectTrigger
                    aria-label="Add a member"
                    className="min-w-48"
                    disabled={candidates.length === 0}
                    data-testid="org-team-add-select"
                  >
                    <SelectValue
                      placeholder={
                        candidates.length === 0 ? "Everyone is in this team" : "Add a member…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {candidateItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!selectedUserId || actions.addTeamMember.isPending}
                  onClick={() =>
                    actions.addTeamMember.mutate(
                      { teamId, userId: selectedUserId },
                      { onSuccess: () => setSelectedUserId("") },
                    )
                  }
                  data-testid="org-team-add-submit"
                >
                  Add
                </Button>
              </div>
            ) : undefined
          }
        />
        {membersQuery.isPending ? (
          <Skeleton className="h-32 w-full rounded-2xl" />
        ) : membersQuery.isError ? (
          <EmptyState
            title="Couldn't load team members"
            description={membersQuery.error.message}
            action={
              <Button variant="outline" onClick={() => void membersQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <DataTable
            testId="org-team-members-table"
            columns={columns}
            data={teamMembers}
            getRowId={(member) => member.userId}
            empty="No members on this team yet."
          />
        )}
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${team.name}?`}
        description="Members lose the areas this team grants. This can't be undone."
        confirmLabel="Delete team"
        variant="destructive"
        isPending={actions.deleteTeam.isPending}
        onConfirm={() => actions.deleteTeam.mutate(teamId, { onSettled: () => setDeleting(false) })}
      />
    </section>
  );
}
