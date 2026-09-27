import {
  DotsThreeIcon,
  FingerprintIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isDeterministicAccountId, type ListedNearAccount } from "better-near-auth";
import { isPasskeyWalletAvailable, type PasskeyWalletNetwork } from "better-near-auth/client";
import { sessionQueryKey, useAuthClient } from "everything-dev/ui/auth";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { nearAccountsQueryKey, passkeyQueryKey } from "@/lib/query-keys";
import { MethodHeader } from "./-method-header";

type NearCallbacks = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

function toPromise(action: (callbacks: NearCallbacks) => unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    void action({ onSuccess: resolve, onError: reject });
  });
}

export function NearMethod({ networkId }: { networkId: PasskeyWalletNetwork }) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const [accountToUnlink, setAccountToUnlink] = useState<ListedNearAccount | null>(null);

  const accountsQuery = useQuery({
    queryKey: nearAccountsQueryKey,
    queryFn: async () => {
      const { data, error } = await auth.near.listAccounts();
      if (error) throw new Error(error.message);
      return data?.accounts ?? [];
    },
  });
  const passkeysQuery = useQuery({
    queryKey: passkeyQueryKey,
    queryFn: async () => {
      const { data, error } = await auth.passkey.listUserPasskeys();
      if (error) throw new Error(error.message);
      return (data || []) as { id: string }[];
    },
    staleTime: 60 * 1000,
  });

  const accounts = accountsQuery.data ?? [];
  const canCreateFromPasskey =
    passkeysQuery.isSuccess &&
    (passkeysQuery.data?.length ?? 0) > 0 &&
    isPasskeyWalletAvailable(networkId);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: nearAccountsQueryKey });
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    void queryClient.invalidateQueries({ queryKey: ["user-invitations"] });
  };
  const onError = (err: Error) => toast.error(err.message);

  const linkNamedMutation = useMutation({
    mutationFn: () => toPromise((callbacks) => auth.near.link(callbacks)),
    onSuccess: () => {
      toast.success("NEAR account linked");
      refresh();
    },
    onError,
  });

  const createFromPasskeyMutation = useMutation({
    mutationFn: () => toPromise((callbacks) => auth.near.linkPasskeyWallet(callbacks)),
    onSuccess: () => {
      toast.success("NEAR account created from your passkey");
      refresh();
    },
    onError,
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (account: ListedNearAccount) => {
      const { error } = await auth.near.setPrimaryAccount({
        accountId: account.accountId,
        network: account.network,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Primary account updated");
      refresh();
    },
    onError,
  });

  const unlinkMutation = useMutation({
    mutationFn: async (account: ListedNearAccount) => {
      const { error } = await auth.near.unlink({
        accountId: account.accountId,
        network: account.network,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setAccountToUnlink(null);
      toast.success("NEAR account unlinked");
      refresh();
    },
    onError,
  });

  const linking = linkNamedMutation.isPending || createFromPasskeyMutation.isPending;

  return (
    <section className="flex flex-col gap-4" data-testid="settings.near-wallet">
      <MethodHeader
        title="NEAR wallet"
        description="Linked NEAR accounts for signing in and signing transactions."
        action={
          <Button
            variant="outline"
            onClick={() => linkNamedMutation.mutate()}
            disabled={linking}
            data-testid="settings.link-near-button"
          >
            <PlusIcon data-icon="inline-start" />
            {linkNamedMutation.isPending
              ? "Connecting…"
              : accounts.length
                ? "Link another account"
                : "Link a named account"}
          </Button>
        }
      />
      {canCreateFromPasskey && accounts.length === 0 && (
        <Item variant="muted" data-testid="settings.create-near-from-passkey">
          <ItemMedia variant="icon">
            <FingerprintIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>No NEAR account yet</ItemTitle>
            <ItemDescription>
              Create one derived from your passkey — no seed phrase, no gas needed.
            </ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => createFromPasskeyMutation.mutate()}
              disabled={linking}
              data-testid="settings.create-near-from-passkey-button"
            >
              {createFromPasskeyMutation.isPending ? "Creating…" : "Create from passkey"}
            </Button>
          </ItemActions>
        </Item>
      )}
      {accountsQuery.isPending ? (
        <Skeleton
          className="h-16 w-full rounded-2xl"
          data-testid="settings.near-accounts-loading"
        />
      ) : accountsQuery.isError ? (
        <p className="text-sm text-destructive" data-testid="settings.near-accounts-error">
          Couldn't load your NEAR accounts.{" "}
          <Button variant="link" size="sm" onClick={() => accountsQuery.refetch()}>
            Retry
          </Button>
        </p>
      ) : accounts.length > 0 ? (
        <ItemGroup>
          {accounts.map((account) => (
            <Item key={account.id} variant="outline" size="sm" role="listitem">
              <ItemMedia variant="icon">
                {isDeterministicAccountId(account.accountId) ? <FingerprintIcon /> : <WalletIcon />}
              </ItemMedia>
              <ItemContent className="basis-0">
                <ItemTitle className="max-w-full">
                  <span className="min-w-0 truncate font-mono">{account.accountId}</span>
                </ItemTitle>
                <ItemDescription>
                  {account.isPrimary ? "Primary" : "Linked"}
                  {account.network === "testnet" && " · testnet"}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {account.isPrimary ? (
                  <Badge variant="success" data-testid={`settings.near-primary-${account.id}`}>
                    Primary
                  </Badge>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${account.accountId}`}
                        data-testid={`settings.near-menu-${account.id}`}
                      />
                    }
                  >
                    <DotsThreeIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!account.isPrimary && (
                      <DropdownMenuItem
                        onClick={() => setPrimaryMutation.mutate(account)}
                        disabled={setPrimaryMutation.isPending}
                      >
                        <StarIcon />
                        Make primary
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setAccountToUnlink(account)}
                    >
                      <TrashIcon />
                      Unlink
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        !canCreateFromPasskey && (
          <p className="text-sm text-muted-foreground" data-testid="settings.near-accounts-empty">
            No NEAR account linked yet. Connect a wallet to stake and publish.
          </p>
        )
      )}

      <ConfirmDialog
        open={!!accountToUnlink}
        onOpenChange={(open: boolean) => {
          if (!open) setAccountToUnlink(null);
        }}
        title="Unlink NEAR account?"
        description={`You won't be able to sign in with ${accountToUnlink?.accountId ?? "this account"} anymore.`}
        confirmLabel="Unlink"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (accountToUnlink) unlinkMutation.mutate(accountToUnlink);
        }}
        isPending={unlinkMutation.isPending}
      />
    </section>
  );
}
