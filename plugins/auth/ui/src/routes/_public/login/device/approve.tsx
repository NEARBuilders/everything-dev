import { CheckCircleIcon, DevicesIcon, KeyIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { InfoPopover } from "@/components/info-popover";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sanitizeUserCode } from "./-user-code";

type SearchParams = {
  user_code?: string;
  pubKey?: string;
  contract?: string;
  account?: string;
  network?: string;
  source?: string;
};

export const Route = createFileRoute("/_public/login/device/approve")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    user_code: sanitizeUserCode(search.user_code),
    pubKey: typeof search.pubKey === "string" ? search.pubKey : undefined,
    contract: typeof search.contract === "string" ? search.contract : undefined,
    account: typeof search.account === "string" ? search.account : undefined,
    network: typeof search.network === "string" ? search.network : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
  }),
  component: DeviceApprovePage,
});

function DeviceApprovePage() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const { user_code, pubKey, contract, account: configAccount, source } = Route.useSearch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  const nearAccountsQuery = useQuery({
    queryKey: ["near-accounts"],
    queryFn: async () => {
      const { data, error } = await auth.near.listAccounts();
      if (error) throw new Error(error.message);
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
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add delegate key");
    },
  });

  if (!session?.user) {
    return <NavigateToLogin userCode={user_code} />;
  }

  const isDelegateMode = !!pubKey && !!contract;

  const handleApprove = async () => {
    if (!user_code) return;
    setPending(true);
    setError(null);
    if (isDelegateMode) {
      try {
        await addDelegateKey.mutateAsync();
      } catch {
        setPending(false);
        setError("The wallet did not add the delegate key. Nothing was approved — try again.");
        return;
      }
    }
    const { error: approveError } = await auth.device.approve({ userCode: user_code });
    setPending(false);
    if (approveError) {
      setError("Could not approve this code. It may have expired or been claimed elsewhere.");
      return;
    }
    if (isDelegateMode || source === "cli") {
      setApproved(true);
      toast.success("Approved — return to your terminal");
      return;
    }
    toast.success("Approved — your other device is signing in");
    void navigate({ to: "/dashboard" });
  };

  const handleDeny = async () => {
    if (!user_code) return;
    setPending(true);
    await auth.device.deny({ userCode: user_code });
    setPending(false);
    toast.info("Sign-in request denied");
    void navigate({ to: "/", replace: true });
  };

  if (approved) {
    return (
      <AuthPanel
        icon={<CheckCircleIcon />}
        title="Return to your terminal"
        titleTestId="device.approved-heading"
        description="The CLI received the credential. You can close this window."
      />
    );
  }

  return (
    <AuthPanel
      icon={isDelegateMode ? <KeyIcon /> : <DevicesIcon />}
      title={isDelegateMode ? "Approve publish key" : "Approve sign-in"}
      titleTestId="device.approve-heading"
      description={
        isDelegateMode
          ? "Adds a publish-only key to your NEAR account so the CLI can publish without gas."
          : "Your other device will be signed in to this account."
      }
    >
      {user_code ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl bg-muted px-6 py-8">
          <span className="text-sm text-muted-foreground">Check it matches your other screen</span>
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
          No code provided. Start again from the other device.
        </p>
      )}

      {isDelegateMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Public key</span>
            <InfoPopover
              title="Publish key"
              body="Only allowed to call __fastdata_kv on the registry, with a 1 NEAR gas allowance. The private key stays on your computer."
            />
          </div>
          <p
            className="break-all font-mono text-xs text-foreground"
            data-testid="device.approve-pubkey"
          >
            {pubKey}
          </p>
          {configAccount && signedInAccountId && signedInAccountId !== configAccount && (
            <p
              className="text-sm wrap-anywhere text-warning-muted-foreground"
              data-testid="device.account-mismatch"
            >
              You're signed in as {signedInAccountId}, not {configAccount}. The key will be added to{" "}
              {signedInAccountId}.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-center text-sm text-destructive" data-testid="device.approve-error">
          {error}
        </p>
      )}

      {user_code && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={handleApprove}
            disabled={pending}
            data-testid="device.approve-button"
          >
            {pending && <Spinner data-icon="inline-start" />}
            {isDelegateMode ? "Approve key" : "Approve"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            onClick={handleDeny}
            disabled={pending}
            data-testid="device.deny-button"
          >
            Deny
          </Button>
        </div>
      )}
    </AuthPanel>
  );
}

function NavigateToLogin({ userCode }: { userCode?: string }) {
  const navigate = useNavigate();
  const target = userCode ? `/login/device?user_code=${userCode}` : "/login/device";
  return (
    <AuthPanel
      icon={<DevicesIcon />}
      title="Sign in to approve"
      titleTestId="device.approve-heading"
      description="Sign in on this device first, then approve the request."
    >
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() => void navigate({ to: "/login", search: { redirect: target } })}
        data-testid="device.approve-signin-button"
      >
        Sign in to continue
      </Button>
    </AuthPanel>
  );
}
