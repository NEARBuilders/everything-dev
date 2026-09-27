import { CheckCircleIcon, DesktopIcon, TicketIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { refreshSessionCache, sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { StepProgress } from "@/components/step-progress";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { getGatewayOrigin } from "@/lib/gateway-origin";
import { DisplayNameStep } from "./-display-name-step";
import { OnboardSignUp } from "./-onboard-sign-up";
import "../../styles.css";

type SearchParams = {
  code?: string;
};

const JOIN_STEPS = ["Create your account", "Join the organization", "Add your name"] as const;

function sanitizeCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{10,64}$/.test(trimmed) ? trimmed : undefined;
}

export const Route = createFileRoute("/_public/onboard")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    code: sanitizeCode(search.code),
  }),
  component: OnboardPage,
});

type Redeemed = { organizationName: string; eventName: string };

function OnboardPage() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const code = sanitizeCode(Route.useSearch().code);
  const { apiClient, runtimeConfig } = Route.useRouteContext();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const { data: info } = useQuery({
    queryKey: ["onboarding-info", code],
    queryFn: async () => {
      return apiClient.auth.getOnboardingCodeInfo({ code: code! });
    },
    enabled: !!code,
  });

  const [accountCreated, setAccountCreated] = useState(false);
  const [redeemed, setRedeemed] = useState<Redeemed | null>(null);
  const [nameDone, setNameDone] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const redeemingRef = useRef(false);

  useEffect(() => {
    if (!session?.user || !code || redeemingRef.current || redeemed || redeemError) return;
    redeemingRef.current = true;
    void apiClient.auth
      .redeemOnboardingCode({ code })
      .then((result: Redeemed) => {
        setRedeemed({ organizationName: result.organizationName, eventName: result.eventName });
        toast.success(`You've joined ${result.organizationName}`);
        void refreshSessionCache(auth, queryClient);
      })
      .catch((error: { message?: string }) => {
        setRedeemError(error?.message || "Could not join this organization");
      });
  }, [session?.user, code, redeemed, redeemError, auth, apiClient, queryClient]);

  if (redeemed) {
    const joinedLine = (
      <span data-testid="onboard.success">
        You've joined{" "}
        <span className="font-medium text-foreground">{redeemed.organizationName}</span> for{" "}
        {redeemed.eventName}.
      </span>
    );

    if (!nameDone) {
      return (
        <AuthPanel
          icon={<CheckCircleIcon />}
          title="You're in"
          titleTestId="onboard.heading"
          description={joinedLine}
        >
          <StepProgress steps={JOIN_STEPS} current={2} testId="onboard.progress" />
          <DisplayNameStep
            initialName={accountCreated ? "" : (session?.user.name ?? "")}
            onDone={() => setNameDone(true)}
          />
        </AuthPanel>
      );
    }

    const gatewayHost = new URL(getGatewayOrigin(runtimeConfig)).host;
    return (
      <AuthPanel
        icon={<CheckCircleIcon />}
        title="You're all set"
        titleTestId="onboard.heading"
        description={joinedLine}
      >
        <Item variant="muted" data-testid="onboard.continue-on-computer">
          <ItemMedia variant="icon">
            <DesktopIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Continue on your computer</ItemTitle>
            <ItemDescription>
              Open{" "}
              <span className="font-mono text-foreground" data-testid="onboard.gateway-origin">
                {gatewayHost}
              </span>
              , pick "Sign in with your phone" and scan the code.
            </ItemDescription>
          </ItemContent>
        </Item>
        <Button
          size="lg"
          className="w-full"
          nativeButton={false}
          render={<Link to="/dashboard" />}
          data-testid="onboard.home-button"
        >
          Go to Home
        </Button>
      </AuthPanel>
    );
  }

  if (!code) {
    return (
      <StatusPanel
        title="Invalid invitation"
        description="This link is missing its code. Ask the organizer for a new QR code."
        testId="onboard.invalid"
      />
    );
  }

  if (info === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-20">
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="onboard.loading"
        >
          <Spinner />
          Loading invitation…
        </p>
      </div>
    );
  }

  if (info === null) {
    return (
      <StatusPanel
        title="Invitation not found"
        description="This onboarding code is invalid. Ask the organizer for a new QR code."
        testId="onboard.not-found"
      />
    );
  }

  if (info.revoked || info.expired || info.usedUp) {
    return (
      <StatusPanel
        title="Invitation unavailable"
        description={
          info.revoked
            ? "This onboarding code was revoked by the organizer."
            : info.expired
              ? "This onboarding code has expired. Ask the organizer for a new one."
              : "This onboarding code has reached its limit. Ask the organizer for a new one."
        }
        testId="onboard.unavailable"
      />
    );
  }

  if (redeemError) {
    return <StatusPanel title="Could not join" description={redeemError} testId="onboard.error" />;
  }

  if (session?.user) {
    return (
      <AuthPanel
        icon={<TicketIcon />}
        title={`Joining ${info.organizationName}`}
        titleTestId="onboard.heading"
      >
        <StepProgress steps={JOIN_STEPS} current={1} testId="onboard.progress" />
        <p
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
          data-testid="onboard.status"
        >
          <Spinner />
          Adding you to {info.eventName}…
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      icon={<TicketIcon />}
      eyebrow={info.inviterName ? `${info.inviterName} invited you` : "You're invited"}
      title={`Join ${info.organizationName}`}
      titleTestId="onboard.heading"
      description={
        <>
          {info.eventName} with{" "}
          <span className="font-medium text-foreground">{info.organizationName}</span>
        </>
      }
      descriptionTestId="onboard.invite"
    >
      <StepProgress steps={JOIN_STEPS} current={0} testId="onboard.progress" />
      <OnboardSignUp
        networkId={runtimeConfig?.networkId ?? "mainnet"}
        onAccountCreated={() => setAccountCreated(true)}
      />
    </AuthPanel>
  );
}

function StatusPanel({
  title,
  description,
  testId,
}: {
  title: string;
  description: string;
  testId: string;
}) {
  return (
    <AuthPanel
      icon={<WarningCircleIcon />}
      title={title}
      titleTestId="onboard.heading"
      description={description}
      descriptionTestId={testId}
    >
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        nativeButton={false}
        render={<Link to="/explore" />}
        data-testid="onboard.explore-button"
      >
        Explore communities
      </Button>
    </AuthPanel>
  );
}
