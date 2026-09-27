import { DeviceMobileIcon, FingerprintIcon, UserPlusIcon, WalletIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { isPasskeyWalletAvailable } from "better-near-auth/client";
import {
  createAccountWithPasskey,
  isPasskeyAutofillAvailable,
  isUnsupportedAuthenticatorError,
  refreshSessionCache,
  sessionQueryOptions,
  signInWithPasskey,
  useAuthClient,
} from "everything-dev/ui/auth";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useIsDesktop } from "@/lib/use-client";
import { useNetworkId } from "@/lib/use-network-id";
import { PairPanel } from "../-pair-panel";

type SearchParams = {
  redirect?: string;
};

type View = "sign-in" | "create" | "phone";

const DEVICE_APPROVAL_PATH = /^\/login\/device(\/approve)?(\?|$)/;

function sanitizeRedirect(url: unknown): string {
  if (
    typeof url !== "string" ||
    !url.startsWith("/") ||
    url.startsWith("//") ||
    url.startsWith("/\\")
  ) {
    return "/dashboard";
  }
  if (url.startsWith("/login") && !DEVICE_APPROVAL_PATH.test(url)) {
    return "/dashboard";
  }
  return url;
}

const STAKE_PATH = /^\/stake(\/|\?|#|$)/;

function signInDescription(redirectTo: string): string {
  if (STAKE_PATH.test(redirectTo)) return "Sign in to stake with a CityNode community.";
  return "Welcome back. Pick how you want to sign in.";
}

export const Route = createFileRoute("/_public/login/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    const { queryClient, authClient } = context;
    const session = await queryClient.query(sessionQueryOptions(authClient));
    if (session?.user && !session.user.banned) {
      throw redirect({ href: sanitizeRedirect(search.redirect) });
    }
  },
  component: LoginPage,
});

type AuthError = { code?: string; message?: string } | Error;

function handleError(error: AuthError) {
  const code = "code" in error ? error.code : undefined;
  const message = "message" in error ? error.message : "Failed to sign in";
  if (code === "UNAUTHORIZED_NONCE_REPLAY") toast.error("Sign-in already used");
  else if (code === "UNAUTHORIZED_INVALID_SIGNATURE") toast.error("Invalid signature");
  else if (code === "SIGNER_NOT_AVAILABLE") toast.error("NEAR wallet not available");
  else if (code === "RECIPIENT_MISMATCH") toast.error("Sign-in configuration error");
  else if (code === "UNAUTHORIZED_INVALID_NONCE") toast.error("Session expired, please try again");
  else toast.error(message || "Failed to sign in");
}

function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const redirectTo = sanitizeRedirect(Route.useSearch().redirect);
  const banned = useRouterState({ select: (state) => state.location.hash === "banned" });
  const networkId = useNetworkId();
  const isDesktop = useIsDesktop();

  const [view, setView] = useState<View>("sign-in");
  const [pending, setPending] = useState<"passkey" | "near" | "create" | null>(null);
  const [detectedAccount, setDetectedAccount] = useState<string | null>(null);
  const [passkeyMissing, setPasskeyMissing] = useState(false);
  const [passkeyAutofill, setPasskeyAutofill] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    void auth.near.detectNearAccount().then((result: { accountId?: string | null } | null) => {
      if (result?.accountId) setDetectedAccount(result.accountId);
    });
  }, [auth.near]);

  const handleSuccess = async (message: string) => {
    toast.success(message);
    await refreshSessionCache(auth, queryClient);
    await navigate({ href: redirectTo, replace: true });
  };
  const onAutofillSignIn = useEffectEvent(() => void handleSuccess("Signed in with passkey"));

  useEffect(() => {
    let cancelled = false;
    void isPasskeyAutofillAvailable().then((available) => {
      if (!available || cancelled) return;
      setPasskeyAutofill(true);
      void signInWithPasskey(auth, { autoFill: true, onSuccess: onAutofillSignIn });
    });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const handleNear = async (switchWallet = false) => {
    setPending("near");
    try {
      if (switchWallet) await auth.near.disconnect();
      await auth.signIn.near({
        onSuccess: async () => {
          setPending(null);
          await handleSuccess("Signed in with NEAR");
        },
        onError: (error: { code?: string; message?: string }) => {
          setPending(null);
          handleError(error);
        },
      });
    } catch {
      setPending(null);
      toast.error("Failed to connect your NEAR wallet");
    }
  };

  const handlePasskey = async () => {
    setPending("passkey");
    setPasskeyMissing(false);
    await signInWithPasskey(auth, {
      onSuccess: async () => {
        setPending(null);
        await handleSuccess("Signed in with passkey");
      },
      onError: () => {
        setPending(null);
        setPasskeyMissing(true);
      },
    });
  };

  const handleCreate = async () => {
    setPending("create");
    setUnsupported(false);
    await createAccountWithPasskey(auth, {
      onSuccess: async () => {
        setPending(null);
        await handleSuccess("Welcome to CityNode");
      },
      onError: (error) => {
        setPending(null);
        if (isUnsupportedAuthenticatorError(error)) setUnsupported(true);
        else toast.error(error.message);
      },
    });
  };

  const nearButton = (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => void handleNear()}
        disabled={pending !== null}
        data-testid="near.signin-button"
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
      {detectedAccount && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => void handleNear(true)}
          disabled={pending !== null}
          data-testid="login.switch-wallet-button"
        >
          Use another wallet
        </Button>
      )}
    </div>
  );

  if (view === "phone") {
    return (
      <AuthPanel
        icon={<DeviceMobileIcon />}
        title="Sign in with your phone"
        titleTestId="login.heading"
        description="Scan with a phone that's signed in to CityNode."
      >
        <PairPanel redirect={redirectTo} onClose={() => setView("sign-in")} />
      </AuthPanel>
    );
  }

  if (view === "create") {
    return (
      <AuthPanel
        icon={<UserPlusIcon />}
        title="Create your account"
        titleTestId="login.heading"
        description={
          isPasskeyWalletAvailable(networkId)
            ? "One passkey on this device. We set up a NEAR wallet for you — no seed phrase."
            : "One passkey on this device. No password to remember."
        }
        footer={
          <>
            <span>Already have an account?</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setView("sign-in")}
              data-testid="login.signin-link"
            >
              Sign in
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void handleCreate()}
            disabled={pending !== null}
            data-testid="login.create-account-button"
          >
            {pending === "create" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FingerprintIcon data-icon="inline-start" />
            )}
            Create account with passkey
          </Button>
          {unsupported && (
            <div className="flex flex-col gap-4" data-testid="login.unsupported-authenticator">
              <p className="text-center text-sm text-muted-foreground">
                This device can't create a supported passkey. Use a NEAR wallet instead.
              </p>
              {nearButton}
            </div>
          )}
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="Sign in to CityNode"
      titleTestId="login.heading"
      description={signInDescription(redirectTo)}
      footer={
        <>
          <span>New here?</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => setView("create")}
            data-testid="login.create-account-link"
          >
            Create an account
          </Button>
        </>
      }
    >
      {banned && (
        <p className="text-center text-sm text-destructive" data-testid="login.banned">
          This account has been suspended.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {passkeyAutofill && (
          <Field>
            <FieldLabel htmlFor="login-passkey-autofill" className="sr-only">
              Saved passkey
            </FieldLabel>
            <Input
              id="login-passkey-autofill"
              type="text"
              name="username"
              autoComplete="username webauthn"
              placeholder="Choose a saved passkey"
              data-testid="login.passkey-autofill"
            />
          </Field>
        )}
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => void handlePasskey()}
          disabled={pending !== null}
          data-testid="login.passkey-button"
        >
          {pending === "passkey" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FingerprintIcon data-icon="inline-start" />
          )}
          {pending === "passkey" ? "Waiting for passkey…" : "Sign in with passkey"}
        </Button>
        {passkeyMissing && (
          <p
            className="text-center text-sm text-muted-foreground"
            data-testid="login.no-passkey-hint"
          >
            No passkey on this device?{" "}
            {isDesktop ? "Use your phone or a NEAR wallet." : "Use a NEAR wallet."}
          </p>
        )}
      </div>
      <FieldSeparator>or</FieldSeparator>
      <div className="flex flex-col gap-3">
        {nearButton}
        {isDesktop && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={() => setView("phone")}
            disabled={pending !== null}
            data-testid="login.device-button"
          >
            <DeviceMobileIcon data-icon="inline-start" />
            Sign in with your phone
          </Button>
        )}
      </div>
    </AuthPanel>
  );
}
