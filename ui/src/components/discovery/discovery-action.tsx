import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DiscoveryAction({
  children,
  label,
  run,
  testId,
  successMessage = "Saved",
  variant = "default",
  onDone,
}: {
  children?: ReactNode;
  label: string;
  testId?: string;
  run: (data: FormData) => Promise<unknown>;
  successMessage?: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  onDone?: () => void;
}) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: run,
    onSuccess: async () => {
      toast.success(successMessage);
      onDone?.();
      await client.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("discover"),
      });
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(new FormData(event.currentTarget));
      }}
    >
      {children}
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      <Button
        data-testid={testId}
        variant={variant}
        className="self-start"
        disabled={mutation.isPending}
      >
        {label}
      </Button>
    </form>
  );
}
