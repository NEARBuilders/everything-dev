import {
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DesktopIcon,
  TicketIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { refreshSessionCache, sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AuthPanel } from "@/components/auth-panel";
import { StepProgress } from "@/components/step-progress";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { LoginI18nProvider, useLoginTranslation } from "@/i18n/runtime";
import { getGatewayOrigin } from "@/lib/gateway-origin";
import {
  fetchOnboardCommunity,
  type OnboardLink,
  readOnboardConfig,
  resolveOnboardLinks,
} from "@/lib/onboard-config";
import { verifyOrganizationMembership } from "@/lib/onboard-membership";
import { cn } from "@/lib/utils";
import { MEMBERSHIP_ENDED_ACTION } from "../../../../src/onboard-config";
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
  component: OnboardRoute,
});

type Redeemed = { organizationId: string; organizationName: string; eventName: string };
type RedeemResult = Redeemed & { alreadyRedeemed: boolean };
type RedeemFailure = { message?: string; code?: string; data?: { action?: string } };
type Membership = "verifying" | "left" | "verifyFailed";

function isMembershipEnded(error: RedeemFailure | undefined): boolean {
  return error?.code === "FORBIDDEN" && error.data?.action === MEMBERSHIP_ENDED_ACTION;
}

const PASSKEY_DEFAULT_NAME = "Passkey user";

function hasChosenName(accountCreated: boolean, name: string | undefined | null): boolean {
  return !accountCreated && !!name && name !== PASSKEY_DEFAULT_NAME;
}

function OnboardRoute() {
  return (
    <LoginI18nProvider>
      <OnboardPage />
    </LoginI18nProvider>
  );
}

function OnboardPage() {
  const t = useLoginTranslation();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const code = sanitizeCode(Route.useSearch().code);
  const { apiClient, runtimeConfig } = Route.useRouteContext();
  const onboardConfig = useMemo(() => readOnboardConfig(runtimeConfig), [runtimeConfig]);
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
  const [linkCopied, setLinkCopied] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const rescanRef = useRef<Redeemed | null>(null);
  const redeemingRef = useRef(false);

  const copyPairLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      toast.success("Link copied — open it on your computer");
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const join = (result: Redeemed, refreshSession: boolean) => {
    setMembership(null);
    setRedeemed({
      organizationId: result.organizationId,
      organizationName: result.organizationName,
      eventName: result.eventName,
    });
    toast.success(`You've joined ${result.organizationName}`);
    if (refreshSession) void refreshSessionCache(auth, queryClient);
  };

  const verifyRescan = (result: Redeemed | null) => {
    rescanRef.current = result;
    setMembership("verifying");
    void verifyOrganizationMembership({
      apiClient: apiClient.auth,
      auth,
      queryClient,
      organizationId: result?.organizationId,
    })
      .then((isMember) => {
        if (result && isMember) {
          join(result, false);
          return;
        }
        setMembership("left");
        void router.invalidate();
      })
      .catch(() => setMembership("verifyFailed"));
  };

  useEffect(() => {
    if (!session?.user || !code || redeemingRef.current || redeemed || redeemError) return;
    redeemingRef.current = true;
    void apiClient.auth
      .redeemOnboardingCode({ code })
      .then((result: RedeemResult) => {
        if (result.alreadyRedeemed) {
          verifyRescan(result);
          return;
        }
        join(result, true);
      })
      .catch((error: RedeemFailure | undefined) => {
        if (isMembershipEnded(error)) {
          verifyRescan(null);
          return;
        }
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

    if (!nameDone && !hasChosenName(accountCreated, session?.user.name)) {
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

    const gatewayOrigin = getGatewayOrigin(runtimeConfig);
    const gatewayHost = new URL(gatewayOrigin).host;
    const pairUrl = `${gatewayOrigin}/login?method=phone`;
    const links = resolveOnboardLinks(onboardConfig, redeemed.organizationId);
    const communityUrl = onboardConfig.community?.url;
    return (
      <AuthPanel
        icon={<CheckCircleIcon />}
        title={onboardConfig.links?.next === undefined ? "Ready to start building?" : "You're in"}
        titleTestId="onboard.heading"
        description={joinedLine}
      >
        {communityUrl ? (
          <JoinedCommunity
            urlTemplate={communityUrl}
            organizationId={redeemed.organizationId}
            organizationName={redeemed.organizationName}
          />
        ) : null}
        {links.next ? <LinkButton link={links.next} testId="onboard.build-button" /> : null}
        <Item variant="muted" data-testid="onboard.continue-on-computer">
          <ItemMedia variant="icon">
            <DesktopIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Continue on your computer</ItemTitle>
            <ItemDescription>
              On your computer, open{" "}
              <span className="font-mono text-foreground" data-testid="onboard.gateway-origin">
                {gatewayHost}/login?method=phone
              </span>{" "}
              — a QR code appears. Scan it with this phone's camera and tap Approve.
            </ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => void copyPairLink(pairUrl)}
              data-testid="onboard.continue-copy-link"
            >
              {linkCopied ? <CheckIcon /> : <CopyIcon />}
              {linkCopied ? "Copied" : "Copy link"}
            </Button>
          </ItemActions>
        </Item>
        <LinkButton link={links.home} testId="onboard.home-button" />
      </AuthPanel>
    );
  }

  const explore = resolveOnboardLinks(onboardConfig).explore;

  if (membership === "verifying") {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-20">
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="onboard.verifying"
        >
          <Spinner />
          {t("auth.onboard.verifying")}
        </p>
      </div>
    );
  }

  if (membership === "left") {
    return (
      <StatusPanel
        title={t("auth.onboard.left.title")}
        description={t("auth.onboard.left.description")}
        testId="onboard.left"
        explore={explore}
      />
    );
  }

  if (membership === "verifyFailed") {
    return (
      <StatusPanel
        title={t("auth.onboard.verifyFailed.title")}
        description={t("auth.onboard.verifyFailed.description")}
        testId="onboard.verify-failed"
        explore={explore}
      >
        <Button
          size="lg"
          className="w-full"
          onClick={() => verifyRescan(rescanRef.current)}
          data-testid="onboard.verify-retry"
        >
          {t("auth.error.retry")}
        </Button>
      </StatusPanel>
    );
  }

  if (!code) {
    return (
      <StatusPanel
        title="Invalid invitation"
        description="This link is missing its code. Ask the organizer for a new QR code."
        testId="onboard.invalid"
        explore={explore}
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
        explore={explore}
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
        explore={explore}
      />
    );
  }

  if (redeemError) {
    return (
      <StatusPanel
        title="Could not join"
        description={redeemError}
        testId="onboard.error"
        explore={explore}
      />
    );
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

function LinkButton({
  link,
  testId,
  variant,
}: {
  link: OnboardLink;
  testId: string;
  variant?: "outline";
}) {
  if (!link.href.startsWith("/")) {
    return (
      <a
        href={link.href}
        className={cn(buttonVariants({ variant, size: "lg" }), "w-full")}
        data-testid={testId}
      >
        {link.label}
      </a>
    );
  }
  return (
    <Button
      variant={variant}
      size="lg"
      className="w-full"
      nativeButton={false}
      render={<Link to={link.href} />}
      data-testid={testId}
    >
      {link.label}
    </Button>
  );
}

function JoinedCommunity({
  urlTemplate,
  organizationId,
  organizationName,
}: {
  urlTemplate: string;
  organizationId: string;
  organizationName: string;
}) {
  const t = useLoginTranslation();
  const { data: community } = useQuery({
    queryKey: ["onboard-community", urlTemplate, organizationId],
    queryFn: () => fetchOnboardCommunity(urlTemplate, organizationId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  if (!community) return null;
  const name = community.name ?? organizationName;
  const channels = community.channels ?? [];
  return (
    <>
      {community.href ? (
        <LinkButton
          link={{ href: community.href, label: t("auth.onboard.visit", { community: name }) }}
          testId="onboard.visit-button"
        />
      ) : null}
      {channels.length > 0 ? (
        <ul
          className="flex flex-wrap justify-center gap-2"
          aria-label={t("auth.onboard.channels", { community: name })}
          data-testid="onboard.channels"
        >
          {channels.map((channel) => (
            <li key={channel.url}>
              <a
                href={channel.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
                data-testid="onboard.channel-link"
              >
                {channel.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function StatusPanel({
  title,
  description,
  testId,
  explore,
  children,
}: {
  title: string;
  description: string;
  testId: string;
  explore: OnboardLink;
  children?: ReactNode;
}) {
  return (
    <AuthPanel
      icon={<WarningCircleIcon />}
      title={title}
      titleTestId="onboard.heading"
      description={description}
      descriptionTestId={testId}
    >
      {children}
      <LinkButton link={explore} testId="onboard.explore-button" variant="outline" />
    </AuthPanel>
  );
}
