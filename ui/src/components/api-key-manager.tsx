import { CheckCircleIcon, CopyIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export interface ApiKeyFormValues {
  name: string;
  expiresIn?: number;
}

interface ApiKeyFormProps {
  onCreate: (values: ApiKeyFormValues) => void;
  isPending: boolean;
}

const EXPIRATION_PRESETS = [
  { label: "Never expires", value: "0" },
  { label: "7 days", value: String(7 * 24 * 60 * 60) },
  { label: "30 days", value: String(30 * 24 * 60 * 60) },
  { label: "90 days", value: String(90 * 24 * 60 * 60) },
  { label: "1 year", value: String(365 * 24 * 60 * 60) },
];

export function ApiKeyForm({ onCreate, isPending }: ApiKeyFormProps) {
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState("0");

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        const seconds = Number(expiresIn);
        onCreate({ name: name.trim(), expiresIn: seconds > 0 ? seconds : undefined });
        setName("");
        setExpiresIn("0");
      }}
    >
      <Field className="min-w-0 flex-1">
        <FieldLabel htmlFor="api-key-name" className="sr-only">
          Key name
        </FieldLabel>
        <Input
          id="api-key-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={64}
          placeholder="Key name, e.g. Deploy bot"
          data-testid="api-key-name-input"
        />
      </Field>
      <div className="flex gap-2">
        <Select
          value={expiresIn}
          items={EXPIRATION_PRESETS}
          onValueChange={(value) => setExpiresIn(value ?? "0")}
        >
          <SelectTrigger
            aria-label="Expiration"
            className="min-w-36 flex-1 sm:flex-none"
            data-testid="api-key-expiry-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRATION_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          variant="outline"
          disabled={isPending || !name.trim()}
          data-testid="api-key-create-button"
        >
          <PlusIcon />
          {isPending ? "Creating…" : "Create key"}
        </Button>
      </div>
    </form>
  );
}

export interface ApiKeyRevealProps {
  apiKey: {
    id: string;
    name: string | null;
    prefix: string | null;
    start: string | null;
    key: string;
    createdAt: string | Date;
  };
  onDismiss: () => void;
}

export function ApiKeyReveal({ apiKey, onDismiss }: ApiKeyRevealProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.key);
      toast.success("API key copied");
    } catch {
      toast.error("Failed to copy API key");
    }
  };

  return (
    <Card data-testid="api-key-reveal">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium text-foreground">{apiKey.name ?? "New key"} created</span>
            <span className="text-sm text-muted-foreground">
              Copy it now. You won't see the full key again.
            </span>
          </div>
        </div>
        <InputGroup>
          <InputGroupInput
            readOnly
            value={apiKey.key}
            aria-label="New API key"
            className="font-mono"
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={handleCopy} aria-label="Copy API key">
              <CopyIcon />
              Copy
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button variant="ghost" size="sm" className="self-end" onClick={onDismiss}>
          Done
        </Button>
      </CardContent>
    </Card>
  );
}
