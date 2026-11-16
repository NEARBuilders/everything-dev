import { PlusIcon, TrashIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createDataTableColumnHelper, DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AreaPicker, areaLabel } from "./area-picker";
import { OrgLink } from "./org-link";
import { RowMenu } from "./row-menu";
import type { TeamRow } from "./types";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useOrgWorkspace } from "./workspace-context";

const columnHelper = createDataTableColumnHelper<TeamRow>();

export function OrgTeamsPage() {
  const { snapshot, canManage } = useOrgWorkspace();
  const actions = useWorkspaceActions();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeamRow | null>(null);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "Team",
        sortFn: "text",
        cell: ({ row }) => (
          <OrgLink
            section={{ to: "team", teamId: row.original.id }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
            data-testid={`org-team-link-${row.original.id}`}
          >
            {row.original.name}
          </OrgLink>
        ),
      }),
      columnHelper.accessor((team) => team.areas.join(" "), {
        id: "areas",
        header: "Areas",
        sortFn: "text",
        cell: ({ row }) =>
          row.original.areas.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.areas.map((area) => (
                <Badge key={area} variant="outline">
                  {areaLabel(area)}
                </Badge>
              ))}
            </div>
          ),
      }),
      columnHelper.accessor((team) => new Date(team.createdAt).getTime(), {
        id: "created",
        header: "Created",
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
                    label={`Actions for ${row.original.name}`}
                    testId={`org-team-menu-${row.original.id}`}
                  >
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteTarget(row.original)}
                    >
                      <TrashIcon />
                      Delete team
                    </DropdownMenuItem>
                  </RowMenu>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canManage],
  );

  return (
    <section className="flex flex-col gap-4" data-testid="org-teams">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search teams"
          className="max-w-xs"
          data-testid="org-teams-search"
        />
        {canManage && (
          <Button
            className="ml-auto"
            onClick={() => setCreating(true)}
            data-testid="org-teams-create"
          >
            <PlusIcon />
            New team
          </Button>
        )}
      </div>
      <DataTable
        testId="org-teams-table"
        columns={columns}
        data={snapshot.teams}
        getRowId={(team) => team.id}
        search={search}
        empty={
          <EmptyState
            icon={UsersThreeIcon}
            title="No teams yet"
            description="Teams group members and grant them feature areas."
          />
        }
      />
      <CreateTeamDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "team"}?`}
        description="Members lose the areas this team grants. This can't be undone."
        confirmLabel="Delete team"
        variant="destructive"
        isPending={actions.deleteTeam.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          actions.deleteTeam.mutate(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
        }}
      />
    </section>
  );
}

function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { createTeam } = useWorkspaceActions();
  const [name, setName] = useState("");
  const [areas, setAreas] = useState<string[]>([]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            createTeam.mutate(
              { name: trimmed, areas },
              {
                onSuccess: () => {
                  setName("");
                  setAreas([]);
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>
              Create a team and choose what its members can reach.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="team-name">Name</FieldLabel>
              <Input
                id="team-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Finance"
                data-testid="org-team-name-input"
              />
            </Field>
            <AreaPicker value={areas} onChange={setAreas} testIdPrefix="org-new-team-area" />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTeam.isPending || !name.trim()}
              data-testid="org-team-create-submit"
            >
              {createTeam.isPending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
