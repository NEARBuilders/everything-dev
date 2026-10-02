import { PencilSimpleIcon, SignOutIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { Organization } from "@/app";
import { Badge, Button, ConfirmDialog, LocalDate, PageHeader } from "@/components";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { roleLabel } from "./-org-avatar";
import { RowMenu } from "./-row-menu";

type PendingConfirm = "delete" | "leave" | null;

export function OrganizationOverview({
  canDelete,
  memberCount,
  myRole,
  isActive,
  isDeleting,
  isLeaving,
  isPersonal,
  isSwitching,
  onDelete,
  onEdit,
  onLeave,
  onSwitch,
  org,
}: {
  canDelete: boolean;
  memberCount: number;
  myRole?: string | null;
  isActive: boolean;
  isDeleting: boolean;
  isPersonal: boolean;
  isLeaving: boolean;
  isSwitching: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onLeave: () => void;
  onSwitch: () => void;
  org: Organization;
}) {
  const [confirming, setConfirming] = useState<PendingConfirm>(null);
  const canEdit = canDelete && !isPersonal;
  const canLeave = !isPersonal && !canDelete;
  const hasMenu = canEdit || canLeave;

  return (
    <>
      <PageHeader
        label={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="org-badges">
            {myRole && <Badge variant="secondary">{roleLabel(myRole)}</Badge>}
            {isActive && <Badge variant="success">Active</Badge>}
            {isPersonal && <Badge variant="outline">Personal</Badge>}
          </span>
        }
        title={org.name}
        description={
          <span className="text-base">
            <span className="font-mono break-all">@{org.slug}</span> · {memberCount} member
            {memberCount === 1 ? "" : "s"}
            {org.createdAt ? (
              <>
                {" "}
                · created <LocalDate value={org.createdAt} />
              </>
            ) : null}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {!isActive && (
              <Button onClick={onSwitch} disabled={isSwitching} data-testid="org-make-active">
                {isSwitching ? "Switching…" : "Make active"}
              </Button>
            )}
            {hasMenu && (
              <RowMenu label="Organization actions" testId="org-actions-menu">
                {canEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    <PencilSimpleIcon />
                    Edit details
                  </DropdownMenuItem>
                )}
                {canLeave && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirming("leave")}
                    disabled={isLeaving}
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
                      disabled={isDeleting}
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
      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Delete ${org.name}?`}
        description="Members lose access and its teams, invitations and API keys are removed. This cannot be undone."
        confirmLabel="Delete organization"
        variant="destructive"
        isPending={isDeleting}
        onConfirm={() => {
          onDelete();
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
        isPending={isLeaving}
        onConfirm={() => {
          onLeave();
          setConfirming(null);
        }}
      />
    </>
  );
}
