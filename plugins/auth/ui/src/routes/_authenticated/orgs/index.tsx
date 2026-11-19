import { BankIcon, EnvelopeSimpleIcon, PlusIcon, WalletIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { OrgAvatar, roleLabel } from "@/components/org/org-avatar";
import { useInvitationActions } from "@/components/org/use-invitation-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuthApiClient } from "@/lib/api";
import { organizationsQueryKey, userInvitationsQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";

const organizationsQueryOptions = (api: AuthApiClient) => ({
  queryKey: organizationsQueryKey,
  queryFn: () => api.listOrganizations(),
  staleTime: 30 * 1000,
});

const userInvitationsQueryOptions = (api: AuthApiClient) => ({
  queryKey: userInvitationsQueryKey,
  queryFn: () => api.listUserInvitations(),
  staleTime: 30 * 1000,
});

const contextQueryOptions = (api: AuthApiClient) => ({
  queryKey: ["auth-context"] as const,
  queryFn: () => api.getContext(),
  staleTime: 30 * 1000,
});

export const Route = createFileRoute("/_authenticated/orgs/")({
  head: () => ({
    meta: [
      { title: "Organizations" },
      { name: "description", content: "Your organizations, their members and teams." },
    ],
  }),
  loader: async ({ context }) => {
    const api = context.apiClient.auth;
    await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
    await context.queryClient.ensureQueryData(organizationsQueryOptions(api));
    await context.queryClient.prefetchQuery(userInvitationsQueryOptions(api));
    await context.queryClient.prefetchQuery(contextQueryOptions(api));
  },
  component: OrganizationsList,
});

function OrganizationsList() {
  const auth = useAuthClient();
  const api = useAuthApi();
  const router = useRouter();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const { data: organizations, isPending } = useQuery(organizationsQueryOptions(api));
  const { data: userInvitations = [] } = useQuery(userInvitationsQueryOptions(api));
  const { data: requestContext } = useQuery(contextQueryOptions(api));

  const orgs = organizations ?? [];
  const rolesByOrg = new Map(
    (requestContext?.organizations ?? []).map((org) => [org.id, org.role]),
  );
  const pendingInvitations = userInvitations.filter(
    (invitation) => invitation.status === "pending",
  );

  const { acceptMutation, rejectMutation } = useInvitationActions({
    onAccepted: async (invitation) => {
      toast.success(`Joined ${invitation.organizationName ?? "organization"}`);
      if (invitation.organizationSlug) {
        await router.navigate({ to: "/orgs/$slug", params: { slug: invitation.organizationSlug } });
      }
    },
    onRejected: () => {
      toast.success("Invitation declined");
    },
  });

  const user = session?.user;
  const activeOrgId = session?.session?.activeOrganizationId;
  const invitationBusy = acceptMutation.isPending || rejectMutation.isPending;
  const hasInvitations = pendingInvitations.length > 0;

  return (
    <PageContainer variant="wide">
      <PageHeader
        title="Organizations"
        description="Groups you belong to. The active one decides what you manage."
        headerTestId="orgs.heading"
        actions={
          orgs.length > 0 ? (
            <Button
              variant={hasInvitations ? "outline" : "default"}
              nativeButton={false}
              render={<Link to="/orgs/new" />}
              data-testid="orgs-new-button"
            >
              <PlusIcon />
              New organization
            </Button>
          ) : null
        }
      />

      {hasInvitations && (
        <section className="flex flex-col gap-4" data-testid="orgs-invitations">
          <SectionHeader title={`Invitations (${pendingInvitations.length})`} />
          <div className="flex flex-col gap-2">
            {pendingInvitations.map((invitation) => {
              const orgName = invitation.organizationName ?? invitation.organizationSlug ?? "";
              return (
                <Item key={invitation.id} variant="outline">
                  <ItemMedia>
                    <OrgAvatar name={orgName || "?"} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="min-w-0 truncate">{orgName}</span>
                    </ItemTitle>
                    <ItemDescription className="wrap-anywhere">
                      {roleLabel(invitation.role)} ·{" "}
                      {invitation.nearAccountId ? (
                        <WalletIcon className="inline size-3.5" />
                      ) : (
                        <EnvelopeSimpleIcon className="inline size-3.5" />
                      )}{" "}
                      {invitation.nearAccountId ?? invitation.email} · expires{" "}
                      <LocalDate value={invitation.expiresAt} format="relative" />
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="w-full sm:w-auto">
                    <Button
                      variant="ghost"
                      className="flex-1 sm:flex-none"
                      onClick={() => rejectMutation.mutate(invitation)}
                      disabled={invitationBusy}
                    >
                      {rejectMutation.isPending && rejectMutation.variables?.id === invitation.id
                        ? "Declining…"
                        : "Decline"}
                    </Button>
                    <Button
                      className="flex-1 sm:flex-none"
                      onClick={() => acceptMutation.mutate(invitation)}
                      disabled={invitationBusy}
                    >
                      {acceptMutation.isPending && acceptMutation.variables?.id === invitation.id
                        ? "Joining…"
                        : "Accept"}
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </div>
        </section>
      )}

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} className="h-40 w-full" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <EmptyState
          icon={BankIcon}
          title="No organizations yet"
          description="Create one to invite people, form teams and start a community."
          action={
            <Button nativeButton={false} render={<Link to="/orgs/new" />}>
              <PlusIcon />
              Create organization
            </Button>
          }
        />
      ) : (
        <section className="flex flex-col gap-4 animate-in fade-in-0 duration-150">
          {hasInvitations && <SectionHeader title="Your organizations" />}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {orgs.map((org) => {
              const myRole = rolesByOrg.get(org.id);
              const isActive = org.id === activeOrgId;
              const isPersonal = user
                ? org.slug === user.id || org.metadata?.isPersonal === true
                : false;
              return (
                <Card key={org.id} data-testid={`orgs-card-${org.slug}`}>
                  <CardContent className="flex h-full flex-col gap-5 p-5">
                    <Link
                      to="/orgs/$slug"
                      params={{ slug: org.slug }}
                      className="flex min-w-0 items-start gap-3 outline-none focus-visible:underline"
                    >
                      <OrgAvatar name={org.name} logo={org.logo} size="lg" />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-lg font-medium text-foreground">
                          {org.name}
                        </span>
                        <span className="truncate font-mono text-sm text-muted-foreground">
                          @{org.slug}
                        </span>
                      </div>
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      {myRole && <Badge variant="secondary">{roleLabel(myRole)}</Badge>}
                      {isActive && <Badge variant="success">Active</Badge>}
                      {isPersonal && <Badge variant="outline">Personal</Badge>}
                    </div>
                    <div className="mt-auto flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link to="/orgs/$slug" params={{ slug: org.slug }} />}
                      >
                        Open
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </PageContainer>
  );
}
