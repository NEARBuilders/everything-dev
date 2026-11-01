import { DeviceMobileIcon, FingerprintIcon, UserPlusIcon, WalletIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { isPasskeyWalletAvailable } from "better-near-auth/client";
import {
  cancelPasskeyCeremony,
  createAccountWithPasskey,
  isPasskeyCeremonyAborted,
  isUnsupportedAuthenticatorError,
  refreshSessionCache,
  sessionQueryOptions,
  signInWithPasskey,
  useAuthClient,
} from "everything-dev/ui/auth";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { ErrorDetail } from "@/components/error-detail";
import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { LoginTranslator } from "@/i18n/catalogs";
import { LoginLanguageSelector } from "@/i18n/language-selector";
import { LoginI18nProvider, useLoginTranslation } from "@/i18n/runtime";
import { markAddEmailPromptPending } from "@/lib/add-email-prompt";
import { siteErrorMessage } from "@/lib/site-error";
import { useIsDesktop } from "@/lib/use-client";
import { useNetworkId } from "@/lib/use-network-id";
import { PairPanel } from "../-pair-panel";

type SearchParams = {
  redirect?: string;
  method?: "phone";
  ref?: string;
};

type View = "sign-in" | "create" | "phone";

const DEVICE_APPROVAL_PATH = /^\/login\/device(\/approve)?(\?|$)/;
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{8}$/;

function sanitizeReferralCode(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const code = url.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : undefined;
}

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

function signInDescription(redirectTo: string, t: LoginTranslator): string {
  if (STAKE_PATH.test(redirectTo)) return t("auth.login.subtitle.stake");
  return t("auth.login.subtitle");
}

export const Route = createFileRoute("/_public/login/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: sanitizeRedirect(search.redirect),
    method: search.method === "phone" ? ("phone" as const) : undefined,
    ref: sanitizeReferralCode(search.ref),
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

type AuthError = { code?: string; message?: string; detail?: string; status?: number } | Error;

type ErrorState = { message: string; detail: string | null };

function signInError(error: AuthError, t: LoginTranslator): ErrorState {
  const code = typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "UNAUTHORIZED_NONCE_REPLAY")
    return { message: t("auth.login.error.used"), detail: null };
  if (code === "UNAUTHORIZED_INVALID_SIGNATURE") {
    return { message: t("auth.login.error.signature"), detail: null };
  }
  if (code === "SIGNER_NOT_AVAILABLE") {
    return { message: t("auth.login.error.walletUnavailable"), detail: null };
  }
  if (code === "RECIPIENT_MISMATCH") {
    return { message: t("auth.login.error.configuration"), detail: null };
  }
  if (code === "UNAUTHORIZED_INVALID_NONCE") {
    return { message: t("auth.login.error.expired"), detail: null };
  }
  return siteErrorMessage(error, t("auth.login.error.generic"));
}

function LoginPage() {
  return (
    <LoginI18nProvider>
      <LoginPageContent />
    </LoginI18nProvider>
  );
}

function LoginPageContent() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const t = useLoginTranslation();
  const redirectTo = sanitizeRedirect(Route.useSearch().redirect);
  const wantsPhone = Route.useSearch().method === "phone";
  const referralCode = Route.useSearch().ref;
  const banned = useRouterState({ select: (state) => state.location.hash === "banned" });
  const networkId = useNetworkId();
  const isDesktop = useIsDesktop();

  const [view, setView] = useState<View>(wantsPhone && isDesktop ? "phone" : "sign-in");
  const [pending, setPending] = useState<"passkey" | "near" | "create" | null>(null);
  const [detectedAccount, setDetectedAccount] = useState<string | null>(null);
  const [passkeyMissing, setPasskeyMissing] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

  useEffect(() => {
    void auth.near.detectNearAccount().then((result: { accountId?: string | null } | null) => {
      if (result?.accountId) setDetectedAccount(result.accountId);
    });
  }, [auth.near]);

  const handleSuccess = async (message: string) => {
    setError(null);
    toast.success(message);
    await refreshSessionCache(auth, queryClient);
    await navigate({ href: redirectTo, replace: true });
  };

  const handleNear = async (switchWallet = false) => {
    cancelPasskeyCeremony();
    setPending("near");
    try {
      if (switchWallet) await auth.near.disconnect();
      await auth.signIn.near(
        {
          onSuccess: async () => {
            setPending(null);
            await handleSuccess(t("auth.login.success.near"));
          },
          onError: (error) => {
            setPending(null);
            setError(signInError(error, t));
          },
        },
        referralCode ? { headers: { "x-referral-code": referralCode } } : undefined,
      );
    } catch {
      setPending(null);
      setError({ message: t("auth.login.error.nearConnect"), detail: null });
    }
  };

  const handlePasskey = async () => {
    cancelPasskeyCeremony();
    setPending("passkey");
    setPasskeyMissing(false);
    await signInWithPasskey(auth, {
      onSuccess: async () => {
        setPending(null);
        await handleSuccess(t("auth.login.success.passkey"));
      },
      onError: (error) => {
        setPending(null);
        if (isPasskeyCeremonyAborted(error)) return;
        if (error.status !== undefined) {
          setError(siteErrorMessage(error, t("auth.login.error.passkey")));
          return;
        }
        if (!isUnsupportedAuthenticatorError(error)) setPasskeyMissing(true);
      },
    });
  };

  const handleCreate = async () => {
    cancelPasskeyCeremony();
    setPending("create");
    setUnsupported(false);
    await createAccountWithPasskey(auth, {
      referralCode,
      onSuccess: async () => {
        setPending(null);
        markAddEmailPromptPending();
        await handleSuccess(t("auth.login.success.create"));
      },
      onError: (error) => {
        setPending(null);
        if (isUnsupportedAuthenticatorError(error)) setUnsupported(true);
        else if (!isPasskeyCeremonyAborted(error))
          setError(siteErrorMessage(error, t("auth.login.error.generic")));
      },
    });
  };

  const switchView = (next: View) => {
    setError(null);
    setView(next);
  };

  const referralChip = referralCode ? (
    <p className="text-center text-sm text-muted-foreground" data-testid="login.referral-chip">
      {t("auth.login.referral.applied", { code: referralCode })}
    </p>
  ) : null;

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
          {detectedAccount
            ? t("auth.login.near.continueAs", { account: detectedAccount })
            : t("auth.login.near.action")}
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
          {t("auth.login.near.useAnother")}
        </Button>
      )}
    </div>
  );

  if (view === "phone") {
    return (
      <AuthPanel
        icon={<DeviceMobileIcon />}
        toolbar={<LoginLanguageSelector />}
        title={t("auth.login.phone.title")}
        titleTestId="login.heading"
        description={t("auth.login.phone.subtitle")}
      >
        <PairPanel redirect={redirectTo} onClose={() => switchView("sign-in")} />
      </AuthPanel>
    );
  }

  if (view === "create") {
    return (
      <AuthPanel
        icon={<UserPlusIcon />}
        toolbar={<LoginLanguageSelector />}
        title={t("auth.login.create.title")}
        titleTestId="login.heading"
        description={
          isPasskeyWalletAvailable(networkId)
            ? t("auth.login.create.subtitle.wallet")
            : t("auth.login.create.subtitle.default")
        }
        footer={
          <>
            <span>{t("auth.login.create.existing")}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => switchView("sign-in")}
              data-testid="login.signin-link"
            >
              {t("auth.login.signIn")}
            </Button>
          </>
        }
      >
        {referralChip}
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
            {t("auth.login.create.action")}
          </Button>
          {unsupported && (
            <div className="flex flex-col gap-4" data-testid="login.unsupported-authenticator">
              <p className="text-center text-sm text-muted-foreground">
                {t("auth.login.create.unsupported")}
              </p>
              {nearButton}
            </div>
          )}
          {error && (
            <ErrorDetail
              message={error.message}
              detail={error.detail}
              testId="login.create-error"
            />
          )}
        </div>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      toolbar={<LoginLanguageSelector />}
      title={t("auth.login.title")}
      titleTestId="login.heading"
      description={signInDescription(redirectTo, t)}
      footer={
        <>
          <span>{t("auth.login.create.new")}</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => switchView("create")}
            data-testid="login.create-account-link"
          >
            {t("auth.login.create.link")}
          </Button>
        </>
      }
    >
      {banned && (
        <p className="text-center text-sm text-destructive" data-testid="login.banned">
          {t("auth.login.suspended")}
        </p>
      )}
      {referralChip}
      <div className="flex flex-col gap-3">
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
          {pending === "passkey" ? t("auth.login.passkey.pending") : t("auth.login.passkey.action")}
        </Button>
        {passkeyMissing && (
          <p
            className="text-center text-sm text-muted-foreground"
            data-testid="login.no-passkey-hint"
          >
            {isDesktop
              ? t("auth.login.passkey.missingDesktop")
              : t("auth.login.passkey.missingMobile")}
          </p>
        )}
        {error && (
          <ErrorDetail message={error.message} detail={error.detail} testId="login.error" />
        )}
      </div>
      <FieldSeparator>{t("auth.login.separator")}</FieldSeparator>
      <div className="flex flex-col gap-3">
        {nearButton}
        {isDesktop && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={() => switchView("phone")}
            disabled={pending !== null}
            data-testid="login.device-button"
          >
            <DeviceMobileIcon data-icon="inline-start" />
            {t("auth.login.phone.action")}
          </Button>
        )}
      </div>
    </AuthPanel>
  );
}
