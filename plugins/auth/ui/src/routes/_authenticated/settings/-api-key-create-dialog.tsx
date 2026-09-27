import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ApiKeyFormValues {
  name: string;
  expiresIn?: number;
}

const DAY = 24 * 60 * 60;

const EXPIRATION_ITEMS = [
  { label: "Never", value: "0" },
  { label: "7 days", value: String(7 * DAY) },
  { label: "30 days", value: String(30 * DAY) },
  { label: "90 days", value: String(90 * DAY) },
  { label: "1 year", value: String(365 * DAY) },
];

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: ApiKeyFormValues) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState("0");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const seconds = Number(expiresIn);
    onCreate({ name: trimmed, expiresIn: seconds > 0 ? seconds : undefined });
    setName("");
    setExpiresIn("0");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              You'll see the full key once, right after creating it.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
              <Input
                id="api-key-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                placeholder="e.g. Claude desktop"
                data-testid="api-keys.name-input"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key-expiry">Expires</FieldLabel>
              <Select
                value={expiresIn}
                items={EXPIRATION_ITEMS}
                onValueChange={(value) => setExpiresIn(value ?? "0")}
              >
                <SelectTrigger
                  id="api-key-expiry"
                  className="w-full"
                  data-testid="api-keys.expiry-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATION_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name.trim()}
              data-testid="api-keys.create-submit"
            >
              {isPending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
