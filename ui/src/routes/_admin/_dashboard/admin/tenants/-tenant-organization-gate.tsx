import type { MutableRefObject } from "react";
import { Button, Field, FieldLabel, Input } from "@/components";
import { FieldDescription, FieldGroup } from "@/components/ui/field";
import { deriveSlug } from "@/lib/slug";

export function TenantOrganizationGate({
  orgName,
  orgSlug,
  orgSlugManuallyEdited,
  isPending,
  onOrgNameChange,
  onOrgSlugChange,
  onSubmit,
}: {
  orgName: string;
  orgSlug: string;
  orgSlugManuallyEdited: MutableRefObject<boolean>;
  isPending: boolean;
  onOrgNameChange: (value: string) => void;
  onOrgSlugChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="flex max-w-xl flex-col gap-6"
      data-testid="admin-tenant-org-gate"
    >
      <p className="text-sm text-muted-foreground">Sites belong to an organization.</p>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
          <Input
            id="org-name"
            value={orgName}
            onChange={(event) => {
              const value = event.target.value;
              onOrgNameChange(value);
              onOrgSlugChange(deriveSlug(value, orgSlug, orgSlugManuallyEdited.current));
            }}
            placeholder="My Organization"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="org-slug">Organization slug</FieldLabel>
          <Input
            id="org-slug"
            value={orgSlug}
            onChange={(event) => {
              orgSlugManuallyEdited.current = true;
              onOrgSlugChange(event.target.value.replace(/[^a-z0-9-]/g, ""));
            }}
            placeholder="my-organization"
            pattern="[a-z0-9-]+"
            required
            className="font-mono"
          />
          <FieldDescription>Lowercase letters, numbers and hyphens.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button
        type="submit"
        className="w-full sm:w-auto sm:self-start"
        disabled={isPending || !orgName || !orgSlug}
      >
        {isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
