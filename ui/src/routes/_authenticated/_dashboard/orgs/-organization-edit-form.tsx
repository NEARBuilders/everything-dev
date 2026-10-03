import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
} from "@/components";
import { FieldGroup } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

export function OrganizationEditForm({
  open,
  editName,
  editSlug,
  isPending,
  onCancel,
  onNameChange,
  onSave,
  onSlugChange,
}: {
  open: boolean;
  editName: string;
  editSlug: string;
  isPending: boolean;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onSlugChange: (value: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (editName && editSlug) onSave();
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
                type="text"
                value={editName}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Organization name"
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
                  type="text"
                  value={editSlug}
                  onChange={(event) => onSlugChange(event.target.value.replace(/[^a-z0-9-]/g, ""))}
                  placeholder="handle"
                  pattern="[a-z0-9-]+"
                  className="font-mono"
                />
              </InputGroup>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !editName || !editSlug}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
