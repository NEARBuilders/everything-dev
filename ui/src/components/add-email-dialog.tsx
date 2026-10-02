import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshSessionCache } from "everything-dev/ui/auth";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuthClient } from "@/app";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface AddEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddEmailDialog({ open, onOpenChange }: AddEmailDialogProps) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (newEmail: string) => {
      const { error: apiError } = await auth.$fetch("/set-email", {
        method: "POST",
        body: { email: newEmail },
      });
      const message =
        apiError && typeof apiError === "object" && "message" in apiError
          ? (apiError as { message?: string }).message
          : undefined;
      if (apiError) throw new Error(message || "Could not save email");
    },
    onSuccess: async () => {
      await refreshSessionCache(auth, queryClient);
      toast.success("Email saved");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter your email");
      return;
    }
    setError(null);
    mutation.mutate(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Add your email</DialogTitle>
            <DialogDescription>
              So you can sign in from another device and recover your account.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="add-email-input">Email</FieldLabel>
            <Input
              id="add-email-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              data-testid="add-email.input"
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>We won't share it. You can change it later.</FieldDescription>
            )}
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
              data-testid="add-email.cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              data-testid="add-email.save"
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
