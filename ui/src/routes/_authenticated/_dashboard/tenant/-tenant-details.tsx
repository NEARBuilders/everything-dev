import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Badge, Button, Input, LocalDate, SectionHeader } from "@/components";
import { SettingsRow } from "./-settings-row";
import type { TenantRecord } from "./-tenant-types";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  suspended: "Suspended",
  pending_deletion: "Pending deletion",
};

const STATUS_BADGE = {
  active: "success",
  suspended: "warning",
  pending_deletion: "destructive",
} as const;

export function TenantDetails({
  tenant,
  hostname,
  orgSlug,
  isOwner,
  editor,
}: {
  tenant: TenantRecord;
  hostname: string | null;
  orgSlug: string | null;
  isOwner: boolean;
  editor: {
    editing: boolean;
    name: string;
    isPending: boolean;
    onEdit: () => void;
    onCancel: () => void;
    onSave: () => void;
    onNameChange: (name: string) => void;
  };
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="General" sectionTestId="tenant.section.general" />
      <div className="flex flex-col">
        <SettingsRow
          label="Name"
          action={
            isOwner && !editor.editing ? (
              <Button variant="ghost" size="sm" onClick={editor.onEdit}>
                Rename
              </Button>
            ) : undefined
          }
        >
          {editor.editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                editor.onSave();
              }}
              className="flex max-w-md flex-wrap gap-2"
            >
              <Input
                id="tenant-edit-name"
                aria-label="Community name"
                value={editor.name}
                autoFocus
                onChange={(event) => editor.onNameChange(event.target.value)}
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={editor.isPending || !editor.name.trim()}>
                {editor.isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={editor.onCancel}>
                Cancel
              </Button>
            </form>
          ) : (
            tenant.name
          )}
        </SettingsRow>
        <SettingsRow label="Status">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={STATUS_BADGE[tenant.status as keyof typeof STATUS_BADGE] ?? "secondary"}
              data-testid="tenant.status"
            >
              {STATUS_LABEL[tenant.status] ?? tenant.status}
            </Badge>
            <Badge variant="outline">{tenant.ownerKind === "dao" ? "DAO-owned" : "Platform"}</Badge>
          </span>
        </SettingsRow>
        <SettingsRow label="Address">
          <span className="font-mono break-all">{hostname ?? "Not bound yet"}</span>
        </SettingsRow>
        <SettingsRow label="Account">
          <span className="font-mono break-all">{tenant.accountId}</span>
        </SettingsRow>
        <SettingsRow
          label="Organization"
          description="Members, roles and invitations."
          action={
            orgSlug ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to="/orgs/$slug" params={{ slug: orgSlug }} />}
                data-testid="tenant.open-organization"
              >
                Manage
                <ArrowRightIcon />
              </Button>
            ) : undefined
          }
        >
          <span className="font-mono break-all">{orgSlug ? `@${orgSlug}` : tenant.orgId}</span>
        </SettingsRow>
        <SettingsRow label="Created">
          <LocalDate value={tenant.createdAt} fallback="—" />
          {tenant.updatedAt ? (
            <span className="text-muted-foreground">
              {" "}
              · updated <LocalDate value={tenant.updatedAt} format="relative" />
            </span>
          ) : null}
        </SettingsRow>
      </div>
    </section>
  );
}
