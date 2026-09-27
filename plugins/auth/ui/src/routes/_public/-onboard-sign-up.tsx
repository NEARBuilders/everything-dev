import { FingerprintIcon, WalletIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { isPasskeyWalletAvailable, type PasskeyWalletNetwork } from "better-near-auth/client";
import {
  createAccountWithPasskey,
  isUnsupportedAuthenticatorError,
  refreshSessionCache,
  signInWithPasskey,
  useAuthClient,
} from "everything-dev/ui/auth";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Mode = "create" | "existing";

export function OnboardSignUp({
  networkId,
  onAccountCreated,
}: {
  networkId: PasskeyWalletNetwork;
  onAccountCreated: () => void;
}) {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("create");
  const [pending, setPending] = useState<"create" | "passkey" | "near" | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [passkeyMissing, setPasskeyMissing] = useState(false);
  const [detectedAccount, setDetectedAccount] = useState<string | null>(null);
  const walletAvailable = isPasskeyWalletAvailable(networkId);

  useEffect(() => {
    void auth.near.detectNearAccount().then((result: { accountId?: string | null } | null) => {
      if (result?.accountId) setDetectedAccount(result.accountId);
    });
  }, [auth.near]);

  const handleCreate = async () => {
    setPending("create");
    setUnsupported(false);
    await createAccountWithPasskey(auth, {
      onSuccess: async () => {
        onAccountCreated();
        await refreshSessionCache(auth, queryClient);
        setPending(null);
      },
      onError: (error) => {
        setPending(null);
        if (isUnsupportedAuthenticatorError(error)) setUnsupported(true);
        else toast.error(error.message);
      },
    });
  };

  const handlePasskeySignIn = async () => {
    setPending("passkey");
    setPasskeyMissing(false);
    await signInWithPasskey(auth, {
      onSuccess: async () => {
        await refreshSessionCache(auth, queryClient);
        setPending(null);
      },
      onError: () => {
        setPending(null);
        setPasskeyMissing(true);
      },
    });
  };

  const handleNear = async (switchWallet = false) => {
    setPending("near");
    try {
      if (switchWallet) await auth.near.disconnect();
      await auth.signIn.near({
        onSuccess: async () => {
          await refreshSessionCache(auth, queryClient);
          setPending(null);
        },
        onError: (error: { message?: string }) => {
          setPending(null);
          toast.error(error?.message || "Failed to sign in");
        },
      });
    } catch {
      setPending(null);
      toast.error("Failed to connect your NEAR wallet");
    }
  };

  const nearButtons = (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => void handleNear()}
        disabled={pending !== null}
        className="w-full"
        data-testid="onboard.signin-button"
      >
        {pending === "near" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <WalletIcon data-icon="inline-start" />
        )}
        <span className="min-w-0 truncate">
          {detectedAccount ? `Continue as ${detectedAccount}` : "Continue with NEAR"}
        </span>
      </Button>
      {detectedAccount ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => void handleNear(true)}
          disabled={pending !== null}
        >
          Use another wallet
        </Button>
      ) : null}
    </div>
  );

  if (mode === "existing") {
    return (
      <div className="flex flex-col gap-3" data-testid="onboard.existing-account">
        <Button
          type="button"
          size="lg"
          onClick={() => void handlePasskeySignIn()}
          disabled={pending !== null}
          className="w-full"
          data-testid="onboard.passkey-signin-button"
        >
          {pending === "passkey" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FingerprintIcon data-icon="inline-start" />
          )}
          {pending === "passkey" ? "Waiting for passkey…" : "Sign in with passkey"}
        </Button>
        {passkeyMissing ? (
          <p
            className="text-center text-sm text-muted-foreground"
            data-testid="onboard.no-passkey-hint"
          >
            No passkey on this device? Use a NEAR wallet instead.
          </p>
        ) : null}
        {nearButtons}
        <Button
          type="button"
          variant="ghost"
          onClick={() => setMode("create")}
          disabled={pending !== null}
          className="self-center"
          data-testid="onboard.create-account-link"
        >
          I'm new here
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        size="lg"
        onClick={() => void handleCreate()}
        disabled={pending !== null}
        className="w-full"
        data-testid="onboard.create-account-button"
      >
        {pending === "create" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <FingerprintIcon data-icon="inline-start" />
        )}
        {pending === "create" ? "Waiting for passkey…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground" data-testid="onboard.passkey-note">
        {walletAvailable
          ? "Uses a passkey on this device and sets up a NEAR wallet for you. No seed phrase."
          : "Uses a passkey on this device. No password to remember."}
      </p>
      {unsupported ? (
        <div className="flex flex-col gap-3" data-testid="onboard.unsupported-authenticator">
          <p className="text-center text-sm text-muted-foreground">
            This device can't create a supported passkey. Use a NEAR wallet instead.
          </p>
          {nearButtons}
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setMode("existing")}
        disabled={pending !== null}
        className="self-center"
        data-testid="onboard.existing-account-button"
      >
        I already have an account
      </Button>
    </div>
  );
}
