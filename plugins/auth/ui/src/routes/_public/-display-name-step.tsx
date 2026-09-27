import { useQueryClient } from "@tanstack/react-query";
import { refreshSessionCache, useAuthClient } from "everything-dev/ui/auth";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function DisplayNameStep({
  initialName,
  onDone,
}: {
  initialName: string;
  onDone: () => void;
}) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    const { error } = await auth.updateUser({ name: trimmed });
    setPending(false);
    if (error) {
      toast.error(error.message || "Could not save your name");
      return;
    }
    await refreshSessionCache(auth, queryClient);
    onDone();
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
      data-testid="onboard.display-name"
    >
      <Field>
        <FieldLabel htmlFor="onboard-display-name">What should organizers call you?</FieldLabel>
        <Input
          id="onboard-display-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          autoComplete="name"
          maxLength={64}
          data-testid="onboard.display-name-input"
        />
      </Field>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || !name.trim()}
        data-testid="onboard.display-name-save"
      >
        {pending ? "Saving…" : "Continue"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="self-center"
        onClick={onDone}
        disabled={pending}
        data-testid="onboard.display-name-skip"
      >
        Skip for now
      </Button>
    </form>
  );
}
