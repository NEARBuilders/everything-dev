import { DeviceMobileIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { useEffect, useState } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/_public/login/device/")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    user_code: sanitizeUserCode(search.user_code),
    pubKey: typeof search.pubKey === "string" ? search.pubKey : undefined,
    contract: typeof search.contract === "string" ? search.contract : undefined,
    account: typeof search.account === "string" ? search.account : undefined,
    network: typeof search.network === "string" ? search.network : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
  }),
  component: DeviceVerifyPage,
});

function DeviceVerifyPage() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const { user_code, pubKey, contract, account, network, source } = Route.useSearch();
  const [code, setCode] = useState(user_code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!session?.user || !user_code || claiming) return;
    setClaiming(true);
    void auth.device({ query: { user_code } }).then(({ data, error }) => {
      if (error || !data) {
        setClaiming(false);
        setError("This code is invalid or has expired. Ask for a new one.");
        return;
      }
      void navigate({
        to: "/login/device/approve",
        search: { user_code, pubKey, contract, account, network, source },
      });
    });
  }, [session?.user, user_code, claiming, auth, navigate]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const cleaned = code.trim().replace(/-/g, "").toUpperCase();
    if (!cleaned) return;
    void navigate({
      to: "/login/device",
      search: { user_code: cleaned, pubKey, contract, account, network, source },
    });
  };

  const signInToContinue = () => {
    const deviceSearch = new URLSearchParams();
    for (const [key, value] of Object.entries({
      user_code,
      pubKey,
      contract,
      account,
      network,
      source,
    })) {
      if (value) deviceSearch.set(key, value);
    }
    const query = deviceSearch.toString();
    void navigate({
      to: "/login",
      search: { redirect: `/login/device${query ? `?${query}` : ""}` },
    });
  };

  return (
    <AuthPanel
      icon={<DeviceMobileIcon />}
      title="Approve a sign-in"
      titleTestId="device.verify-heading"
      description={
        user_code
          ? "Check this code matches the one on your other screen."
          : "Enter the code shown on your other screen."
      }
    >
      {user_code ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl bg-muted px-6 py-8">
          <span
            className="font-mono text-3xl font-semibold tracking-widest break-all text-foreground"
            data-testid="device.verified-code"
          >
            {user_code}
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Field>
            <FieldLabel htmlFor="device-user-code" className="sr-only">
              Device code
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="device-user-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="XXXX-XXXX"
                maxLength={12}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="one-time-code"
                className="flex-1 font-mono"
                data-testid="device.user-code-input"
              />
              <Button type="submit" disabled={!code.trim()} data-testid="device.verify-button">
                Continue
              </Button>
            </div>
          </Field>
        </form>
      )}

      {error && (
        <p className="text-center text-sm text-destructive" data-testid="device.verify-error">
          {error}
        </p>
      )}

      {claiming && (
        <p
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
          data-testid="device.claiming"
        >
          <Spinner />
          Checking the code…
        </p>
      )}

      {!session?.user && (
        <Button
          type="button"
          size="lg"
          variant={user_code ? "default" : "outline"}
          className="w-full"
          onClick={signInToContinue}
          data-testid="device.signin-redirect-button"
        >
          Sign in to continue
        </Button>
      )}
    </AuthPanel>
  );
}
