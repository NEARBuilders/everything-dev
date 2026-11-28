import { PencilSimpleIcon, SignOutIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/layout/page-header";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrgAvatar, roleLabel } from "./org-avatar";
import { RowMenu } from "./row-menu";
import type { OrgStatus } from "./types";
import { useWorkspaceActions } from "./use-workspace-actions";
import { useOrgWorkspace } from "./workspace-context";

const STATUS_ITEMS: Array<{ label: string; value: OrgStatus }> = [
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Rejected", value: "rejected" },
];

type Confirming = "delete" | "leave" | null;

export function OrgHeader() {
  const { org, mode, myRole, isActive, isOwner, isPersonal, adapter } = useOrgWorkspace();
  const actions = useWorkspaceActions();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [editing, setEditing] = useState(false);

  const canEdit = isOwner && !isPersonal;
  const canLeave = adapter.capabilities.leave && !isPersonal && !isOwner;
  const canSwitch = adapter.capabilities.switchActive && !isActive;
  const hasMenu = canEdit || canLeave;

  return (
    <>
      <PageHeader
        label={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="org-badges">
            {mode === "admin" && <Badge variant="outline">Admin view</Badge>}
            {myRole && <Badge variant="secondary">{roleLabel(myRole)}</Badge>}
            {isActive && <Badge variant="success">Active</Badge>}
            {isPersonal && <Badge variant="outline">Personal</Badge>}
            {org.status !== "active" && (
              <Badge variant="destructive">{roleLabel(org.status)}</Badge>
            )}
          </span>
        }
        title={
          <span className="flex items-center gap-4">
            <OrgAvatar name={org.name} logo={org.logo} size="lg" />
            <span className="min-w-0">{org.name}</span>
          </span>
        }
        subtitle={`@${org.slug}`}
        actions={
          <div className="flex items-center gap-2">
            {canSwitch && (
              <Button
                onClick={() => actions.makeActive.mutate()}
                disabled={actions.makeActive.isPending}
                data-testid="org-make-active"
              >
                {actions.makeActive.isPending ? "Switching…" : "Make active"}
              </Button>
            )}
            {hasMenu && (
              <RowMenu label="Organization actions" testId="org-actions-menu">
                {canEdit && (
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilSimpleIcon />
                    Edit details
                  </DropdownMenuItem>
                )}
                {canLeave && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirming("leave")}
                    disabled={actions.leaveOrganization.isPending}
                  >
                    <SignOutIcon />
                    Leave organization
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setConfirming("delete")}
                      disabled={actions.deleteOrganization.isPending}
                    >
                      <TrashIcon />
                      Delete organization
                    </DropdownMenuItem>
                  </>
                )}
              </RowMenu>
            )}
          </div>
        }
      />
      <EditOrganizationDialog open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Delete ${org.name}?`}
        description="Members lose access and its teams, invitations and API keys are removed. This cannot be undone."
        confirmLabel="Delete organization"
        variant="destructive"
        isPending={actions.deleteOrganization.isPending}
        onConfirm={() => {
          actions.deleteOrganization.mutate();
          setConfirming(null);
        }}
      />
      <ConfirmDialog
        open={confirming === "leave"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Leave ${org.name}?`}
        description="You'll need a new invitation to rejoin."
        confirmLabel="Leave"
        variant="destructive"
        isPending={actions.leaveOrganization.isPending}
        onConfirm={() => {
          actions.leaveOrganization.mutate();
          setConfirming(null);
        }}
      />
    </>
  );
}

function EditOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { org, adapter } = useOrgWorkspace();
  const { updateOrganization } = useWorkspaceActions();
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [status, setStatus] = useState<OrgStatus>(org.status);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName(org.name);
          setSlug(org.slug);
          setStatus(org.status);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name || !slug) return;
            updateOrganization.mutate(
              {
                name,
                slug,
                ...(adapter.capabilities.setStatus ? { status } : {}),
              },
              { onSuccess: () => onOpenChange(false) },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
            <DialogDescription>Changing the handle changes its links.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="organization-edit-name">Name</FieldLabel>
              <Input
                id="organization-edit-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Organization name"
                data-testid="org-edit-name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="organization-edit-slug">Handle</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>@</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="organization-edit-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value.replace(/[^a-z0-9-]/g, ""))}
                  placeholder="handle"
                  pattern="[a-z0-9-]+"
                  className="font-mono"
                  data-testid="org-edit-slug"
                />
              </InputGroup>
            </Field>
            {adapter.capabilities.setStatus && (
              <Field>
                <FieldLabel htmlFor="organization-edit-status">Status</FieldLabel>
                <Select
                  value={status}
                  items={STATUS_ITEMS}
                  onValueChange={(value) => {
                    if (value === "active" || value === "pending" || value === "rejected") {
                      setStatus(value);
                    }
                  }}
                >
                  <SelectTrigger
                    id="organization-edit-status"
                    className="w-full"
                    data-testid="org-edit-status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateOrganization.isPending || !name || !slug}
              data-testid="org-edit-save"
            >
              {updateOrganization.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
