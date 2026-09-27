import { DotsThreeIcon, FingerprintIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Passkey, useAuthClient } from "everything-dev/ui/auth";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { passkeyQueryKey } from "@/lib/query-keys";
import { MethodHeader } from "./-method-header";

export function PasskeysMethod() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const { data: passkeys = [], isPending } = useQuery({
    queryKey: passkeyQueryKey,
    queryFn: async () => {
      const { data } = await auth.passkey.listUserPasskeys();
      return (data || []) as Passkey[];
    },
    staleTime: 60 * 1000,
  });

  const [adding, setAdding] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyToDelete, setPasskeyToDelete] = useState<Passkey | null>(null);

  const addPasskeyMutation = useMutation({
    mutationFn: async () => {
      const name = passkeyName.trim();
      const { error } = name
        ? await auth.passkey.addPasskey({ name })
        : await auth.passkey.addPasskey();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setPasskeyName("");
      setAdding(false);
      toast.success("Passkey added");
      void queryClient.invalidateQueries({ queryKey: passkeyQueryKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removePasskeyMutation = useMutation({
    mutationFn: async (passkeyId: string) => {
      const { error } = await auth.passkey.deletePasskey({ id: passkeyId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setPasskeyToDelete(null);
      toast.success("Passkey removed");
      void queryClient.invalidateQueries({ queryKey: passkeyQueryKey });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    addPasskeyMutation.mutate();
  };

  return (
    <section className="flex flex-col gap-4" data-testid="settings.passkeys">
      <MethodHeader
        title="Passkeys"
        description="Sign in with your fingerprint, face or device PIN."
        action={
          <Button
            variant="outline"
            onClick={() => setAdding(true)}
            data-testid="settings.add-passkey-button"
          >
            <PlusIcon data-icon="inline-start" />
            Add passkey
          </Button>
        }
      />
      {isPending ? (
        <Skeleton className="h-16 w-full rounded-2xl" data-testid="settings.passkeys-loading" />
      ) : passkeys.length > 0 ? (
        <ItemGroup>
          {passkeys.map((passkey) => (
            <Item key={passkey.id} variant="outline" size="sm" role="listitem">
              <ItemMedia variant="icon">
                <FingerprintIcon />
              </ItemMedia>
              <ItemContent className="basis-0">
                <ItemTitle className="max-w-full">
                  <span className="min-w-0 truncate">{passkey.name || "Passkey"}</span>
                </ItemTitle>
                {passkey.createdAt && (
                  <ItemDescription>
                    Added <LocalDate value={passkey.createdAt} />
                  </ItemDescription>
                )}
              </ItemContent>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={removePasskeyMutation.isPending}
                        aria-label={`Actions for ${passkey.name || "passkey"}`}
                        data-testid={`settings.passkey-menu-${passkey.id}`}
                      />
                    }
                  >
                    <DotsThreeIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPasskeyToDelete(passkey)}
                    >
                      <TrashIcon />
                      Remove passkey
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="settings.passkeys-empty">
          No passkeys yet. Add one to sign in with your fingerprint or face.
        </p>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle>Add a passkey</DialogTitle>
              <DialogDescription>Your device will ask you to confirm.</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="settings-passkey-name">Name</FieldLabel>
              <Input
                id="settings-passkey-name"
                type="text"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                placeholder="e.g. Work laptop"
                maxLength={64}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addPasskeyMutation.isPending}>
                {addPasskeyMutation.isPending ? "Waiting for passkey…" : "Create passkey"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!passkeyToDelete}
        onOpenChange={(open: boolean) => {
          if (!open) setPasskeyToDelete(null);
        }}
        title="Remove passkey?"
        description={`You won't be able to sign in with ${passkeyToDelete?.name || "this passkey"} anymore.`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (passkeyToDelete) removePasskeyMutation.mutate(passkeyToDelete.id);
        }}
        isPending={removePasskeyMutation.isPending}
      />
    </section>
  );
}
