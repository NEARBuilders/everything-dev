import { CopyIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sessionQueryKey, sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/layout/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InfoRow } from "@/components/ui/info-row";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

type ProfileUser = {
  id: string;
  email?: string;
  name?: string;
  isAnonymous?: boolean | null;
};

export function ProfileSettings() {
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const user = session?.user;

  if (!user) return null;

  return (
    <>
      <section className="flex flex-col gap-6">
        <SectionHeader
          title="Profile"
          description="How organizers and members see you."
          sectionTestId="settings.profile-heading"
        />
        {user.isAnonymous && (
          <Item variant="muted" data-testid="settings.temporary-account">
            <ItemMedia variant="icon">
              <WarningIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Temporary account</ItemTitle>
              <ItemDescription>
                Add a passkey or NEAR wallet so you can sign in again.
              </ItemDescription>
            </ItemContent>
            <ItemActions className="w-full sm:w-auto">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                nativeButton={false}
                render={<Link to="/settings/auth-methods" />}
              >
                Add sign-in method
              </Button>
            </ItemActions>
          </Item>
        )}
        <DisplayNameForm key={user.name ?? ""} user={user} />
      </section>
      <AccountDetails user={user} />
    </>
  );
}

function DisplayNameForm({ user }: { user: ProfileUser }) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name || "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.updateUser({ name: name.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      toast.success("Profile updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const unchanged = name.trim() === (user.name || "");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unchanged || !name.trim()) return;
    updateMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md">
      <Field>
        <FieldLabel htmlFor="settings-display-name">Display name</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="settings-display-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your display name"
            autoComplete="name"
            maxLength={64}
            className="flex-1"
            data-testid="settings.display-name-input"
          />
          <Button
            type="submit"
            disabled={updateMutation.isPending || unchanged || !name.trim()}
            data-testid="settings.display-name-save"
          >
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <FieldDescription>Shown on events you join and in your organizations.</FieldDescription>
      </Field>
    </form>
  );
}

function AccountDetails({ user }: { user: ProfileUser }) {
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      toast.success("User ID copied");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader title="Account" />
      <div className="flex flex-col">
        <InfoRow
          label="Email"
          value={user.email && !user.isAnonymous ? user.email : "Not linked"}
        />
        <InfoRow
          label="Account type"
          value={
            user.isAnonymous ? (
              <Badge variant="warning">Temporary</Badge>
            ) : (
              <Badge variant="secondary">Standard</Badge>
            )
          }
        />
        <InfoRow
          label="User ID"
          mono
          value={
            <span className="inline-flex max-w-full items-center gap-2">
              <span className="min-w-0 text-muted-foreground">{user.id}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void copyId()}
                aria-label="Copy user ID"
              >
                <CopyIcon />
              </Button>
            </span>
          }
        />
      </div>
    </section>
  );
}
