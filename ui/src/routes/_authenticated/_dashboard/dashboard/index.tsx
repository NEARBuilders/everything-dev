import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  type Passkey,
  type SessionData,
  sessionQueryOptions,
  useApiClient,
  useAuthClient,
} from "@/app";
import { PageContainer, PageHeader, SectionHeader, Skeleton } from "@/components";
import { type FeatureArea, isFeatureArea } from "@/lib/feature-areas";
import { pageTitle } from "@/lib/page-title";
import { tenantByOrgQueryOptions } from "@/lib/queries/tenants";
import { useNearAccount } from "@/lib/use-near-account";
import { IdentityCard } from "./-identity-card";
import { type HomeInvitation, InvitationSteps } from "./-invitation-steps";
import { getNextSteps } from "./-next-steps";
import { NextStepsList } from "./-next-steps-list";
import { RestrictedAreaNotice } from "./-restricted-area-notice";

export const Route = createFileRoute("/_authenticated/_dashboard/dashboard/")({
  validateSearch: (search: Record<string, unknown>): { restricted?: FeatureArea | "admin" } =>
    search.restricted === "admin"
      ? { restricted: "admin" }
      : typeof search.restricted === "string" && isFeatureArea(search.restricted)
        ? { restricted: search.restricted }
        : {},
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Home", match.context.runtimeConfig) },
      { name: "description", content: "Your next steps." },
    ],
  }),
  component: Home,
});

function Home() {
  const auth = useAuthClient();
  const apiClient = useApiClient();
  const { restricted } = Route.useSearch();
  const { data: session } = useQuery<SessionData | null>(sessionQueryOptions(auth));
  const nearAccountId = useNearAccount();
  const activeOrgId = session?.session?.activeOrganizationId ?? "";

  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const { data } = await auth.passkey.listUserPasskeys();
      return (data || []) as Passkey[];
    },
    staleTime: 60 * 1000,
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return data || [];
    },
    staleTime: 30 * 1000,
  });
  const invitations = useQuery({
    queryKey: ["user-invitations"],
    queryFn: async (): Promise<HomeInvitation[]> => {
      try {
        return await apiClient.auth.listUserInvitations();
      } catch {
        return [];
      }
    },
    staleTime: 30 * 1000,
  });
  const tenant = useQuery(tenantByOrgQueryOptions(apiClient, activeOrgId));
  const authContext = useQuery({
    queryKey: ["home-auth-context", activeOrgId],
    queryFn: () => apiClient.auth.getContext().catch(() => null),
    enabled: !!activeOrgId,
    staleTime: 30 * 1000,
  });

  const user = session?.user;
  const pending = (invitations.data ?? []).filter((invitation) => invitation.status === "pending");
  const orgs = organizations.data ?? [];
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? null;
  const orgRole = authContext.data?.organization?.member?.role;
  const isAdmin = user?.role === "admin";
  const community = tenant.data ? { name: tenant.data.name, tenantId: tenant.data.id } : null;
  const loading =
    !user || organizations.isPending || (!!activeOrgId && tenant.isPending) || passkeys.isPending;

  const steps = getNextSteps({
    isAnonymous: user?.isAnonymous ?? false,
    hasPasskey: (passkeys.data?.length ?? 0) > 0,
    hasNear: !!nearAccountId,
    organizationCount: orgs.length,
    activeOrganizationName: activeOrg?.name ?? null,
    community,
    canManageCommunity: isAdmin || orgRole === "owner" || orgRole === "admin",
    isAdmin,
  });

  const firstName = user?.isAnonymous ? null : user?.name?.split(" ")[0];

  return (
    <PageContainer>
      {restricted && <RestrictedAreaNotice area={restricted} />}
      <PageHeader
        headerTestId="home.heading"
        title={firstName ? `Welcome back, ${firstName}` : "Home"}
        description="Pick up where you left off."
      />
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-12 lg:col-span-2">
          {pending.length > 0 && (
            <section className="flex flex-col gap-6">
              <SectionHeader title="Invitations" />
              <InvitationSteps invitations={pending} />
            </section>
          )}
          <section className="flex flex-col gap-6">
            <SectionHeader title="Next steps" />
            {loading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-16 w-full rounded-2xl" />
                <Skeleton className="h-16 w-full rounded-2xl" />
              </div>
            ) : (
              <NextStepsList
                steps={steps}
                tenantId={community?.tenantId ?? null}
                primary={pending.length === 0}
              />
            )}
          </section>
        </div>
        <aside className="flex min-w-0 flex-col gap-6">
          {user ? (
            <IdentityCard
              user={user}
              nearAccountId={nearAccountId}
              passkeyCount={passkeys.data?.length ?? 0}
            />
          ) : (
            <Skeleton className="h-56 w-full rounded-2xl" />
          )}
        </aside>
      </div>
    </PageContainer>
  );
}
