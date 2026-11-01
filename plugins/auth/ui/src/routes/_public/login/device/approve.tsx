import { CheckCircleIcon, DevicesIcon, KeyIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { ErrorDetail } from "@/components/error-detail";
import { InfoPopover } from "@/components/info-popover";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LoginI18nProvider, useLoginTranslation } from "@/i18n/runtime";
import { siteErrorMessage } from "@/lib/site-error";
import {
  type DevicePairingSearch,
  devicePairingHref,
  validateDevicePairingSearch,
} from "./-pairing-search";

export const Route = createFileRoute("/_public/login/device/approve")({
  ssr: false,
  validateSearch: validateDevicePairingSearch,
  component: DeviceApprovePage,
});

function DeviceApprovePage() {
  return (
    <LoginI18nProvider>
      <DeviceApproveContent />
    </LoginI18nProvider>
  );
}

function DeviceApproveContent() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const t = useLoginTranslation();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const { user_code, pubKey, contract, account, network, custody, source } = Route.useSearch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; detail: string | null } | null>(null);
  const [approved, setApproved] = useState(false);
  const [custodyWallet, setCustodyWallet] = useState<{
    walletId: string;
    nearAccountId: string;
    handoffUrl: string | null;
  } | null>(null);

  const isCustody = custody === "1";
  const custodyNetwork = network === "testnet" ? "testnet" : "mainnet";

  const registerCustodyWallet = useMutation({
    mutationFn: async () => {
      const { data, error: registerError } = await auth.custody.register({
        network: custodyNetwork,
      });
      if (registerError)
        throw new Error(registerError.message ?? "Custody wallet registration failed");
      return data;
    },
    onSuccess: (data) => {
      setCustodyWallet(data);
    },
    onError: (mutationError: Error) => {
      setError(siteErrorMessage(mutationError, t("auth.device.custody.failed")));
    },
  });

  const nearAccountsQuery = useQuery({
    queryKey: ["near-accounts"],
    queryFn: async () => {
      const { data, error: accountsError } = await auth.near.listAccounts();
      if (accountsError) throw new Error(accountsError.message);
      return data as unknown as {
        accounts: { accountId: string }[];
        activeAccount: { accountId: string } | null;
      };
    },
    enabled: !!session?.user && !!pubKey && !!contract,
  });
  const signedInAccountId = nearAccountsQuery.data?.activeAccount?.accountId ?? null;

  const addDelegateKey = useMutation({
    mutationFn: async () => {
      if (!pubKey || !contract) throw new Error("Missing delegate-key parameters");
      if (!signedInAccountId) throw new Error("Connect a NEAR account first");
      const client = auth.near.getNearClient();
      await client
        .transaction(signedInAccountId)
        .addKey(pubKey, {
          type: "functionCall",
          receiverId: contract,
          methodNames: ["__fastdata_kv"],
          allowance: "1 NEAR",
        })
        .send();
      return true;
    },
    onError: (mutationError: Error) => {
      setError(siteErrorMessage(mutationError, t("auth.device.delegate.toastFailed")));
    },
  });

  if (!session?.user) {
    return (
      <NavigateToLogin
        search={{ user_code, pubKey, contract, account, network, source, custody }}
      />
    );
  }

  const isDelegateMode = !!pubKey && !!contract;

  const handleApprove = async () => {
    if (!user_code) return;
    setPending(true);
    setError(null);
    if (isCustody && !custodyWallet) {
      try {
        await registerCustodyWallet.mutateAsync();
      } catch {
        setPending(false);
        return;
      }
    }
    if (isDelegateMode) {
      try {
        await addDelegateKey.mutateAsync();
      } catch {
        setPending(false);
        return;
      }
    }
    let approveFailure: { message: string; detail: string | null } | null = null;
    try {
      const { error: approveError } = await auth.device.approve({ userCode: user_code });
      if (approveError)
        approveFailure = siteErrorMessage(approveError, t("auth.device.approve.failed"));
    } catch {
      approveFailure = { message: t("auth.device.approve.failed"), detail: null };
    }
    setPending(false);
    if (approveFailure) {
      setError(approveFailure);
      return;
    }
    if (isDelegateMode || source === "cli") {
      setApproved(true);
      toast.success(t("auth.device.approved.cli"));
      return;
    }
    toast.success(t("auth.device.approved.device"));
    void navigate({ to: "/dashboard" });
  };

  const handleDeny = async () => {
    if (!user_code) return;
    setPending(true);
    setError(null);
    let denyFailure: { message: string; detail: string | null } | null = null;
    try {
      const { error: denyError } = await auth.device.deny({ userCode: user_code });
      if (denyError) denyFailure = siteErrorMessage(denyError, t("auth.device.deny.failed"));
    } catch {
      denyFailure = { message: t("auth.device.deny.failed"), detail: null };
    }
    setPending(false);
    if (denyFailure) {
      setError(denyFailure);
      return;
    }
    toast.info(t("auth.device.deny.success"));
    void navigate({ to: "/", replace: true });
  };

  if (approved) {
    return (
      <AuthPanel
        icon={<CheckCircleIcon />}
        title={t("auth.device.approved.title")}
        titleTestId="device.approved-heading"
        description={t("auth.device.approved.description")}
      />
    );
  }

  return (
    <AuthPanel
      icon={isDelegateMode ? <KeyIcon /> : <DevicesIcon />}
      title={
        isDelegateMode ? t("auth.device.approve.delegateTitle") : t("auth.device.approve.title")
      }
      titleTestId="device.approve-heading"
      description={
        isDelegateMode
          ? t("auth.device.approve.delegateDescription")
          : t("auth.device.approve.description")
      }
    >
      {user_code ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl bg-muted px-6 py-8">
          <span className="text-sm text-muted-foreground">
            {t("auth.device.approve.checkMatch")}
          </span>
          <span
            className="font-mono text-3xl font-semibold tracking-widest break-all text-foreground"
            data-testid="device.approve-code"
          >
            {user_code}
          </span>
        </div>
      ) : (
        <p
          className="text-center text-sm text-muted-foreground"
          data-testid="device.approve-missing-code"
        >
          {t("auth.device.approve.noCode")}
        </p>
      )}

      {isDelegateMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t("auth.device.approve.publicKey")}</span>
            <InfoPopover
              title={t("auth.device.approve.publishKeyTitle")}
              body={t("auth.device.approve.publishKeyBody")}
            />
          </div>
          <p
            className="break-all font-mono text-xs text-foreground"
            data-testid="device.approve-pubkey"
          >
            {pubKey}
          </p>
          {account && signedInAccountId && signedInAccountId !== account && (
            <p
              className="text-sm wrap-anywhere text-warning-muted-foreground"
              data-testid="device.account-mismatch"
            >
              {t("auth.device.approve.accountMismatch", {
                signedIn: signedInAccountId,
                expected: account,
              })}
            </p>
          )}
        </div>
      )}

      {isCustody && (
        <div className="flex flex-col gap-2" data-testid="device.approve-custody">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t("auth.device.custody.label")}</span>
            <InfoPopover
              title={t("auth.device.custody.label")}
              body={t("auth.device.custody.body")}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("auth.device.custody.description", { network: custodyNetwork })}
          </p>
          {custodyWallet && (
            <div className="flex flex-col gap-1 rounded-2xl bg-muted px-4 py-3 text-sm">
              <span className="break-all font-mono text-xs text-foreground">
                {custodyWallet.nearAccountId}
              </span>
              {custodyWallet.handoffUrl && (
                <a
                  href={custodyWallet.handoffUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  {t("auth.device.custody.dashboard")}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <ErrorDetail message={error.message} detail={error.detail} testId="device.approve-error" />
      )}

      {user_code && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void handleApprove()}
            disabled={pending}
            data-testid="device.approve-button"
          >
            {pending && <Spinner data-icon="inline-start" />}
            {isDelegateMode ? t("auth.device.approve.key") : t("auth.device.approve.approve")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={() => void handleDeny()}
            disabled={pending}
            data-testid="device.deny-button"
          >
            {t("auth.device.approve.deny")}
          </Button>
        </div>
      )}
    </AuthPanel>
  );
}

function NavigateToLogin({ search }: { search: DevicePairingSearch }) {
  const navigate = useNavigate();
  const router = useRouter();
  const t = useLoginTranslation();
  return (
    <AuthPanel
      icon={<DevicesIcon />}
      title={t("auth.device.approve.signInTitle")}
      titleTestId="device.approve-heading"
      description={t("auth.device.approve.signInDescription")}
    >
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() =>
          void navigate({ to: "/login", search: { redirect: devicePairingHref(router, search) } })
        }
        data-testid="device.approve-signin-button"
      >
        {t("auth.device.signIn")}
      </Button>
    </AuthPanel>
  );
}
