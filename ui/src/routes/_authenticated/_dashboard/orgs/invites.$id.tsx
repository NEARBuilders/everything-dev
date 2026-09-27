import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useApiClient, useAuthClient } from "@/app";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  EmptyState,
  LocalDate,
  PageContainer,
  Skeleton,
} from "@/components";
import { pageTitle } from "@/lib/page-title";
import { roleLabel } from "./-org-avatar";
import { useInvitationActions } from "./-use-invitation-actions";

export const Route = createFileRoute("/_authenticated/_dashboard/orgs/invites/$id")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Invitation", match.context.runtimeConfig) }],
  }),
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["invitation", params.id],
      queryFn: () => context.apiClient.auth.getInvitation({ id: params.id }),
      staleTime: 30 * 1000,
      retry: false,
    });
  },
  component: AcceptInvitation,
});

function AcceptInvitation() {
  const { id } = Route.useParams();
  const router = useRouter();
  const auth = useAuthClient();
  const apiClient = useApiClient();

  const { data: invitation, isLoading } = useQuery({
    queryKey: ["invitation", id],
    queryFn: () => apiClient.auth.getInvitation({ id }),
    staleTime: 30 * 1000,
    retry: false,
  });

  const { acceptMutation, rejectMutation } = useInvitationActions({
    apiClient,
    auth,
    onAccepted: async (acceptedInvitation) => {
      toast.success("Invitation accepted");
      if (acceptedInvitation.organizationSlug) {
        await router.navigate({
          to: "/orgs/$slug",
          params: { slug: acceptedInvitation.organizationSlug },
        });
      } else {
        await router.navigate({ to: "/orgs" });
      }
    },
    onRejected: async () => {
      toast.success("Invitation declined");
      await router.navigate({ to: "/orgs" });
    },
  });

  if (isLoading) {
    return (
      <PageContainer variant="narrow">
        <div className="flex flex-col items-center gap-4 py-12">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-48" />
        </div>
      </PageContainer>
    );
  }

  if (!invitation) {
    return (
      <PageContainer variant="narrow">
        <EmptyState
          icon={EnvelopeSimpleIcon}
          title="Invitation not available"
          description="It has expired, was cancelled, or is addressed to another account."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/orgs" />}>
              Go to Organizations
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const busy = acceptMutation.isPending || rejectMutation.isPending;
  const orgName = invitation.organizationName ?? invitation.organizationSlug ?? "an organization";
  const isPending = invitation.status === "pending";

  return (
    <PageContainer variant="narrow">
      <div
        className="flex flex-col items-center gap-8 py-8 text-center sm:py-16"
        data-testid="invite.accept"
      >
        <Avatar className="size-16">
          <AvatarFallback>{orgName.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold wrap-anywhere text-foreground sm:text-4xl">
            Join {orgName}
          </h1>
          <p className="text-base text-muted-foreground">
            You're invited as {roleLabel(invitation.role).toLowerCase()}
            {invitation.teamId ? " on one of its teams" : ""}.
          </p>
        </div>
        {isPending ? (
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <Button
              size="lg"
              onClick={() => acceptMutation.mutate(invitation)}
              disabled={busy}
              data-testid="invite.accept-button"
            >
              {acceptMutation.isPending ? "Joining…" : `Join ${orgName}`}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => rejectMutation.mutate(invitation)}
              disabled={busy}
              data-testid="invite.decline-button"
            >
              {rejectMutation.isPending ? "Declining…" : "Decline"}
            </Button>
          </div>
        ) : (
          <Badge variant="outline">This invitation is {invitation.status}</Badge>
        )}
        <p className="text-sm wrap-anywhere text-muted-foreground">
          For {invitation.nearAccountId ?? invitation.email}
          {invitation.nearAccountId && invitation.nearNetwork
            ? ` on ${invitation.nearNetwork}`
            : ""}{" "}
          · expires <LocalDate value={invitation.expiresAt} format="relative" />
        </p>
      </div>
    </PageContainer>
  );
}
