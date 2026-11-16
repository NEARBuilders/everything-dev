import { DownloadSimpleIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  createDataTableColumnHelper,
  DataTable,
  type RowSelectionState,
} from "@/components/data-table";
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthApi } from "@/lib/use-auth-api";
import { MemberIdentity, memberDisplayName, memberSecondaryLine } from "./member-identity";
import { roleLabel } from "./org-avatar";
import { OrgLink } from "./org-link";
import { RowMenu } from "./row-menu";
import { type MemberRow, ORG_ROLES, type OrgRole } from "./types";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useOrgWorkspace } from "./workspace-context";

const columnHelper = createDataTableColumnHelper<MemberRow>();

export function OrgMembersPage() {
  const { snapshot, canManage, adapter, viewerUserId, org, isPersonal } = useOrgWorkspace();
  const actions = useWorkspaceActions();
  const api = useAuthApi();
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [removeTargets, setRemoveTargets] = useState<MemberRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const exportMembers = useMutation({
    mutationFn: async () => (await api.exportMembers({ organizationId: org.id })).csv,
    onSuccess: (csv) => {
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${org.slug}-members.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Member emails exported");
    },
    onError: (error: Error) => toast.error(error.message || "Failed to export emails"),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor(
        (member) => `${memberDisplayName(member, member.userId)} ${memberSecondaryLine(member)}`,
        {
          id: "member",
          header: "Member",
          sortFn: "text",
          cell: ({ row }) => (
            <MemberIdentity member={row.original} isSelf={row.original.userId === viewerUserId} />
          ),
        },
      ),
      columnHelper.accessor("role", {
        header: "Role",
        sortFn: "text",
        cell: ({ row }) => (
          <Badge variant={row.original.role === "member" ? "outline" : "secondary"}>
            {roleLabel(row.original.role)}
          </Badge>
        ),
      }),
      columnHelper.accessor((member) => new Date(member.createdAt).getTime(), {
        id: "joined",
        header: "Joined",
        sortFn: "alphanumeric",
        cell: ({ row }) => <LocalDate value={row.original.createdAt} format="relative" />,
      }),
      ...(canManage
        ? [
            columnHelper.display({
              id: "actions",
              header: () => <span className="sr-only">Actions</span>,
              cell: ({ row }) => {
                const member = row.original;
                const isSelf = member.userId === viewerUserId;
                const name = memberDisplayName(member, member.userId);
                return (
                  <div className="flex justify-end">
                    <RowMenu
                      label={`Actions for ${name}`}
                      testId={`org-member-menu-${member.userId}`}
                    >
                      {!isSelf &&
                        ORG_ROLES.filter((role) => role !== member.role).map((role) => (
                          <DropdownMenuItem
                            key={role}
                            onClick={() => actions.updateMemberRole.mutate({ member, role })}
                          >
                            Make {role}
                          </DropdownMenuItem>
                        ))}
                      {!isSelf && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={isSelf}
                        onClick={() => setRemoveTargets([member])}
                      >
                        <UserMinusIcon />
                        Remove from organization
                      </DropdownMenuItem>
                    </RowMenu>
                  </div>
                );
              },
            }),
          ]
        : []),
    ],
    [canManage, viewerUserId, actions.updateMemberRole],
  );

  const selectedMembers = snapshot.members.filter((member) => selection[member.userId]);
  const canInvite = adapter.capabilities.invite && !isPersonal;

  return (
    <section className="flex flex-col gap-4" data-testid="org-members">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search members"
          className="max-w-xs"
          data-testid="org-members-search"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selectedMembers.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setRemoveTargets(selectedMembers)}
              data-testid="org-members-bulk-remove"
            >
              <UserMinusIcon />
              Remove {selectedMembers.length}
            </Button>
          )}
          {adapter.capabilities.exportMembers && canManage && (
            <Button
              variant="outline"
              onClick={() => exportMembers.mutate()}
              disabled={exportMembers.isPending}
              data-testid="org-members-export"
            >
              <DownloadSimpleIcon />
              Export emails
            </Button>
          )}
          {adapter.capabilities.addMember && (
            <Button onClick={() => setAdding(true)} data-testid="org-members-add">
              <UserPlusIcon />
              Add member
            </Button>
          )}
          {canInvite && canManage && (
            <Button
              nativeButton={false}
              render={<OrgLink section={{ to: "invitations" }} />}
              data-testid="org-members-invite"
            >
              <UserPlusIcon />
              Invite
            </Button>
          )}
        </div>
      </div>
      <DataTable
        testId="org-members-table"
        columns={columns}
        data={snapshot.members}
        getRowId={(member) => member.userId}
        search={search}
        selectable={canManage}
        selection={selection}
        onSelectionChange={setSelection}
        isRowSelectable={(member) => member.userId !== viewerUserId}
        empty={<EmptyState icon={UsersIcon} title="No members" description="Nobody is here yet." />}
      />
      <ConfirmDialog
        open={removeTargets !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTargets(null);
        }}
        title={
          removeTargets?.length === 1
            ? `Remove ${memberDisplayName(removeTargets[0], removeTargets[0]?.userId ?? "member")}?`
            : `Remove ${removeTargets?.length ?? 0} members?`
        }
        description="They lose access to this organization and its teams."
        confirmLabel="Remove"
        variant="destructive"
        isPending={actions.removeMembers.isPending}
        onConfirm={() => {
          if (!removeTargets) return;
          actions.removeMembers.mutate(removeTargets, {
            onSettled: () => {
              setRemoveTargets(null);
              setSelection({});
            },
          });
        }}
      />
      {adapter.capabilities.addMember && <AddMemberDialog open={adding} onOpenChange={setAdding} />}
    </section>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { snapshot } = useOrgWorkspace();
  const { addMember } = useWorkspaceActions();
  const api = useAuthApi();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const trimmed = query.trim();
  const roleItems = ORG_ROLES.map((value) => ({ label: roleLabel(value), value }));
  const memberIds = new Set(snapshot.members.map((member) => member.userId));

  const results = useQuery({
    queryKey: ["admin-add-member-search", trimmed],
    queryFn: () => api.adminListUsers({ searchValue: trimmed, searchField: "email", limit: 8 }),
    enabled: open && trimmed.length >= 2,
  });
  const candidates = (results.data?.users ?? []).filter((user) => !memberIds.has(user.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Find an existing account by email and add it directly.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="add-member-search">Email</FieldLabel>
            <Input
              id="add-member-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="person@example.com"
              autoComplete="off"
              data-testid="org-add-member-search"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="add-member-role">Role</FieldLabel>
            <Select
              value={role}
              items={roleItems}
              onValueChange={(value) => {
                if (value === "owner" || value === "admin" || value === "member") setRole(value);
              }}
            >
              <SelectTrigger id="add-member-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-col gap-1" data-testid="org-add-member-results">
            {trimmed.length < 2 ? (
              <p className="text-sm text-muted-foreground">Type at least two characters.</p>
            ) : results.isPending ? (
              <p className="text-sm text-muted-foreground">Searching…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching accounts outside this organization.
              </p>
            ) : (
              candidates.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border p-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{user.name || "Unnamed"}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    disabled={addMember.isPending}
                    onClick={() =>
                      addMember.mutate(
                        { userId: user.id, role },
                        { onSuccess: () => onOpenChange(false) },
                      )
                    }
                    data-testid={`org-add-member-${user.id}`}
                  >
                    Add
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
