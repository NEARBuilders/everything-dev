import { useState } from "react";
import { Button, ConfirmDialog, SectionHeader } from "@/components";
import { SettingsRow } from "./-settings-row";
import type { TenantAction, TenantRecord } from "./-tenant-types";

export function TenantDangerZone({
  tenant,
  isOwner,
  isAdmin,
  suspend,
  reactivate,
  open,
  isPending,
  onOpen,
  onOpenChange,
  onConfirm,
}: {
  tenant: TenantRecord;
  isOwner: boolean;
  isAdmin: boolean;
  suspend: TenantAction;
  reactivate: TenantAction;
  open: boolean;
  isPending: boolean;
  onOpen: () => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const canSuspend = isAdmin && tenant.status === "active";
  const canReactivate = isAdmin && tenant.status === "suspended";
  const canDelete = isOwner && tenant.status === "active";

  return (
    <>
      {(canSuspend || canReactivate || canDelete) && (
        <section className="flex flex-col gap-2" data-testid="tenant.danger-zone">
          <SectionHeader title="Danger zone" />
          <div className="flex flex-col rounded-2xl border border-destructive/30 px-4">
            {canSuspend && (
              <SettingsRow
                label="Suspend community"
                description="Takes the site offline until it's reactivated."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSuspendOpen(true)}
                    disabled={suspend.isPending}
                  >
                    Suspend
                  </Button>
                }
              />
            )}
            {canReactivate && (
              <SettingsRow
                label="Reactivate community"
                description="Brings the site back online."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reactivate.mutate()}
                    disabled={reactivate.isPending}
                  >
                    Reactivate
                  </Button>
                }
              />
            )}
            {canDelete && (
              <SettingsRow
                label="Delete community"
                description="Suspended now, removed for good after 30 days."
                action={
                  <Button variant="destructive" size="sm" onClick={onOpen} disabled={isPending}>
                    Delete community
                  </Button>
                }
              />
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={suspendOpen}
        onOpenChange={setSuspendOpen}
        title={`Suspend ${tenant.name}?`}
        description="The site goes offline for everyone until you reactivate it."
        confirmLabel="Suspend"
        variant="destructive"
        isPending={suspend.isPending}
        onConfirm={() => {
          suspend.mutate();
          setSuspendOpen(false);
        }}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Delete ${tenant.name}?`}
        description="It's suspended immediately and permanently deleted after 30 days. This cannot be undone."
        confirmLabel="Delete community"
        variant="destructive"
        onConfirm={onConfirm}
        isPending={isPending}
      />
    </>
  );
}
