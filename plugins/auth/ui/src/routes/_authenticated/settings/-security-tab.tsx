import { DevicesIcon, LockIcon, SignOutIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { clearAuthenticatedQueries, useAuthClient } from "everything-dev/ui/auth";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SectionHeader } from "@/components/layout/section-header";
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

export function SecurityTab({ user }: { user: { email?: string; isAnonymous?: boolean | null } }) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePasswordMutation = useMutation({
    mutationFn: () => {
      if (newPassword !== confirmPassword) throw new Error("Passwords do not match");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      return (async () => {
        const { error } = await auth.changePassword({ currentPassword, newPassword });
        if (error) throw new Error(error.message);
      })();
    },
    onSuccess: () => {
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setChangingPassword(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeSessionsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.revokeOtherSessions();
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setConfirmRevoke(false);
      toast.success("Other sessions revoked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.signOut();
      if (error) throw new Error(error.message || "Failed to sign out");
      await auth.near.disconnect().catch(() => {});
    },
    onSuccess: async () => {
      await clearAuthenticatedQueries(queryClient);
      await navigate({ to: "/", replace: true });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handlePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    changePasswordMutation.mutate();
  };

  const hasPassword = !!user.email && !user.isAnonymous;

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Security"
        description="Passwords and signed-in devices."
        sectionTestId="settings.security-heading"
      />
      <ItemGroup>
        {hasPassword && (
          <Item variant="outline" size="sm" role="listitem">
            <ItemMedia variant="icon">
              <LockIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Password</ItemTitle>
              <ItemDescription className="wrap-anywhere">
                Used when you sign in with {user.email}.
              </ItemDescription>
            </ItemContent>
            <ItemActions className="w-full sm:w-auto">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setChangingPassword(true)}
                data-testid="settings.change-password-button"
              >
                Change password
              </Button>
            </ItemActions>
          </Item>
        )}
        <Item variant="outline" size="sm" role="listitem">
          <ItemMedia variant="icon">
            <DevicesIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Other devices</ItemTitle>
            <ItemDescription>Sign out everywhere except this device.</ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setConfirmRevoke(true)}
              disabled={revokeSessionsMutation.isPending}
              data-testid="settings.revoke-sessions-button"
            >
              Sign out others
            </Button>
          </ItemActions>
        </Item>
        <Item variant="outline" size="sm" role="listitem">
          <ItemMedia variant="icon">
            <SignOutIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>This device</ItemTitle>
            <ItemDescription>Sign out and return to the home page.</ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Button
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => signOutMutation.mutate()}
              disabled={signOutMutation.isPending}
              data-testid="settings.signout-button"
            >
              {signOutMutation.isPending ? "Signing out…" : "Sign out"}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>

      <Dialog open={changingPassword} onOpenChange={setChangingPassword}>
        <DialogContent>
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle>Change password</DialogTitle>
              <DialogDescription>Use at least 8 characters.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="settings-current-password">Current password</FieldLabel>
                <Input
                  id="settings-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-new-password">New password</FieldLabel>
                <Input
                  id="settings-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-confirm-password">Confirm new password</FieldLabel>
                <Input
                  id="settings-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setChangingPassword(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  changePasswordMutation.isPending ||
                  !currentPassword ||
                  !newPassword ||
                  !confirmPassword
                }
              >
                {changePasswordMutation.isPending ? "Updating…" : "Update password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Sign out other devices?"
        description="Every other browser and phone will need to sign in again."
        confirmLabel="Sign out other devices"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => revokeSessionsMutation.mutate()}
        isPending={revokeSessionsMutation.isPending}
      />
    </section>
  );
}
