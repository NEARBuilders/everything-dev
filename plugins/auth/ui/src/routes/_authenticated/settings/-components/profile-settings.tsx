import { CopyIcon, EnvelopeIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sessionQueryKey, sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { AddEmailDialog } from "@/components/add-email-dialog";
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
import type { LoginLocale } from "@/i18n/catalogs";
import { LoginLanguageSelector } from "@/i18n/language-selector";
import { LoginI18nProvider } from "@/i18n/runtime";
import { isSyntheticEmail } from "@/lib/synthetic-email";

type ProfileUser = {
  id: string;
  email?: string;
  name?: string;
  isAnonymous?: boolean | null;
  locale?: string | null;
};

export function ProfileSettings() {
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const user = session?.user;
  const [addEmailOpen, setAddEmailOpen] = useState(false);

  if (!user) return null;

  const emailIsSynthetic = isSyntheticEmail(user.email);
  const showAddEmailPrompt = !user.isAnonymous && emailIsSynthetic;

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
        {showAddEmailPrompt && (
          <Item variant="muted" data-testid="settings.add-email-prompt">
            <ItemMedia variant="icon">
              <EnvelopeIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Add your email</ItemTitle>
              <ItemDescription>
                Sign in from another device and recover your account.
              </ItemDescription>
            </ItemContent>
            <ItemActions className="w-full sm:w-auto">
              <Button
                className="w-full sm:w-auto"
                onClick={() => setAddEmailOpen(true)}
                data-testid="settings.add-email-button"
              >
                Add email
              </Button>
            </ItemActions>
          </Item>
        )}
        <DisplayNameForm key={user.name ?? ""} user={user} />
      </section>
      <LanguageSettings user={user} />
      <AccountDetails user={user} onAddEmail={() => setAddEmailOpen(true)} />
      <AddEmailDialog open={addEmailOpen} onOpenChange={setAddEmailOpen} />
    </>
  );
}

function LanguageSettings({ user }: { user: ProfileUser }) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();

  const saveLocale = async (locale: LoginLocale) => {
    const { error } = await auth.updateUser({ locale });
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    toast.success("Language updated");
  };

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader title="Language" description="Choose the language used across CityNode." />
      <div className="max-w-md">
        <Field>
          <FieldLabel htmlFor="settings-language">Display language</FieldLabel>
          <LoginI18nProvider
            initialLocale={user.locale as LoginLocale | undefined}
            onLocaleChange={saveLocale}
          >
            <LoginLanguageSelector id="settings-language" testId="settings.language-select" />
          </LoginI18nProvider>
          <FieldDescription>
            Your choice is saved to your account and used on every device.
          </FieldDescription>
        </Field>
      </div>
    </section>
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

function AccountDetails({ user, onAddEmail }: { user: ProfileUser; onAddEmail: () => void }) {
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      toast.success("User ID copied");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const emailIsSynthetic = isSyntheticEmail(user.email);
  const emailValue: React.ReactNode =
    emailIsSynthetic || user.isAnonymous ? (
      <span className="inline-flex items-center gap-2">
        <span className="text-muted-foreground">Not linked</span>
        {!user.isAnonymous && (
          <Button
            variant="link"
            size="xs"
            onClick={onAddEmail}
            data-testid="settings.account-add-email"
          >
            Add
          </Button>
        )}
      </span>
    ) : (
      <span className="inline-flex max-w-full items-center gap-2">
        <span className="min-w-0 truncate">{user.email}</span>
      </span>
    );

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader title="Account" />
      <div className="flex flex-col">
        <InfoRow label="Email" value={emailValue} />
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
