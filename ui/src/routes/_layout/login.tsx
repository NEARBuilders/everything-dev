import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getAppName, sessionQueryOptions, useAuthClient } from "@/app";
import builtOn from "@/assets/built_on.png";
import builtOnRev from "@/assets/built_on_rev.png";
import { BrandElement } from "@/components/brand-element";
import { Button } from "@/components/ui/button";
import { NetworkToggle } from "@/components/ui/network-toggle";
import { UnderConstruction } from "@/components/under-construction";

type SearchParams = {
  redirect?: string;
};

export const Route = createFileRoute("/_layout/login")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    const { queryClient, authClient } = context;
    const initialSession = context.session;
    const session =
      initialSession ??
      queryClient.getQueryData(sessionQueryOptions(authClient, initialSession).queryKey);

    if (session?.user) {
      const redirectTo = search.redirect?.startsWith("/") ? search.redirect : "/home";
      throw redirect({ to: redirectTo, search: {} });
    }
  },
  loader: ({ context }) => {
    const initialSession = context.session;
    void context.queryClient.prefetchQuery(sessionQueryOptions(context.authClient, initialSession));
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const { data: session, isLoading } = useQuery(sessionQueryOptions(auth, undefined));
  const { redirect } = Route.useSearch();
  const { runtimeConfig } = Route.useRouteContext();
  const appName = getAppName(runtimeConfig);

  const [nearPending, setNearPending] = useState(false);
  const [anonPending, setAnonPending] = useState(false);
  const [detectedAccount, setDetectedAccount] = useState<{ accountId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (auth.near as any).detectNearAccount?.().then((result: { accountId: string } | null) => {
      if (!cancelled && result) {
        setDetectedAccount({ accountId: result.accountId });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSuccess = (message: string) => {
    const redirectTo = redirect?.startsWith("/") ? redirect : "/home";
    toast.success(message);
    navigate({ to: redirectTo, replace: true, search: {} });
  };

  const handleError = (error: { code?: string; message?: string } | Error) => {
    const code = "code" in error ? error.code : undefined;
    const message = "message" in error ? error.message : "Failed to sign in";
    if (code === "UNAUTHORIZED_NONCE_REPLAY") toast.error("Sign-in already used");
    else if (code === "UNAUTHORIZED_INVALID_SIGNATURE") toast.error("Invalid signature");
    else if (code === "SIGNER_NOT_AVAILABLE") toast.error("NEAR wallet not available");
    else if (code === "RECIPIENT_MISMATCH") toast.error("Sign-in configuration error");
    else if (code === "UNAUTHORIZED_INVALID_NONCE")
      toast.error("Session expired, please try again");
    else toast.error(message || "Failed to sign in");
  };

  const handleNear = async () => {
    setNearPending(true);
    await auth.signIn.near({
      onSuccess: () => {
        setNearPending(false);
        handleSuccess("Signed in with NEAR");
      },
      onError: (error: { code?: string; message?: string }) => {
        setNearPending(false);
        handleError(error);
      },
    });
  };

  const handleAnonymous = async () => {
    setAnonPending(true);
    try {
      await auth.signIn.anonymous({
        fetchOptions: {
          onSuccess: () => {
            setAnonPending(false);
            handleSuccess("Started anonymous session");
          },
          onError: (ctx: { error?: { message?: string } }) => {
            setAnonPending(false);
            handleError(new Error(ctx.error?.message || "Anonymous sign in failed"));
          },
        },
      });
    } catch {
      setAnonPending(false);
    }
  };

  if (session?.user) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-full w-full flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    );
  }

  const isPending = nearPending || anonPending;

  return (
    <div className="min-h-full w-full flex flex-col animate-fade-in">
      <NetworkToggle />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm flex flex-col items-center gap-5">
          <BrandElement appName={appName} size="lg" />

          <div className="w-full rounded-[12px] border border-border bg-card p-6 sm:p-8 space-y-5">
            <div className="space-y-3">
              {detectedAccount ? (
                <>
                  <Button
                    type="button"
                    variant="default"
                    onClick={handleNear}
                    disabled={isPending}
                    className="w-full"
                  >
                    {nearPending ? "connecting..." : `Continue as ${detectedAccount.accountId}`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleNear}
                    disabled={isPending}
                    className="w-full"
                  >
                    Use another wallet
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleNear}
                  disabled={isPending}
                  className="w-full"
                >
                  {nearPending ? "connecting..." : "connect to everything"}
                </Button>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={handleAnonymous}
                disabled={isPending}
                className="w-full text-muted-foreground hover:text-foreground"
              >
                {anonPending ? "starting..." : "continue anonymously"}
              </Button>
            </div>

            <div className="pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                Anonymous sessions don't persist after sign out
              </p>
            </div>
          </div>

          <UnderConstruction
            sourceFile="ui/src/routes/_layout/login.tsx"
            runtimeConfig={runtimeConfig}
          />
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-center py-3">
        <a
          href="https://near.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="relative block h-5 w-[84px]"
        >
          <img
            src={builtOn}
            alt="Built on NEAR"
            className="absolute inset-0 h-full w-full object-contain dark:hidden"
          />
          <img
            src={builtOnRev}
            alt="Built on NEAR"
            className="absolute inset-0 hidden h-full w-full object-contain dark:block"
          />
        </a>
      </div>
    </div>
  );
}
