import { CopyIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CreatedApiKey {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  key: string;
  createdAt: string | Date;
}

export function ApiKeyRevealDialog({
  apiKey,
  onDismiss,
}: {
  apiKey: CreatedApiKey | null;
  onDismiss: () => void;
}) {
  const handleCopy = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey.key);
      toast.success("API key copied");
    } catch {
      toast.error("Failed to copy API key");
    }
  };

  return (
    <Dialog
      open={!!apiKey}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent data-testid="api-keys.reveal">
        <DialogHeader>
          <DialogTitle>Copy your new key</DialogTitle>
          <DialogDescription>
            You won't see {apiKey?.name ? `"${apiKey.name}"` : "this key"} in full again. Store it
            somewhere safe.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <code
            className="block rounded-2xl bg-muted p-4 font-mono text-sm break-all text-foreground select-all"
            data-testid="api-keys.secret"
          >
            {apiKey?.key ?? ""}
          </code>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void handleCopy()}
            data-testid="api-keys.copy-button"
          >
            <CopyIcon data-icon="inline-start" />
            Copy key
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onDismiss} data-testid="api-keys.reveal-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
