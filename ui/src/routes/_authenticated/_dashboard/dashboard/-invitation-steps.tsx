import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { type ApiClient, useApiClient, useAuthClient } from "@/app";
import { Button, LocalDate } from "@/components";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { useInvitationActions } from "../orgs/-use-invitation-actions";

export type HomeInvitation = Awaited<ReturnType<ApiClient["auth"]["listUserInvitations"]>>[number];

export function InvitationSteps({ invitations }: { invitations: HomeInvitation[] }) {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const navigate = useNavigate();
  const { acceptMutation, rejectMutation } = useInvitationActions({
    apiClient,
    auth,
    onAccepted: async (invitation) => {
      toast.success(`Joined ${invitation.organizationName ?? "organization"}`);
      if (invitation.organizationSlug) {
        await navigate({ to: "/orgs/$slug", params: { slug: invitation.organizationSlug } });
      }
    },
    onRejected: () => {
      toast.success("Invitation declined");
    },
  });
  const busy = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <ItemGroup data-testid="home-invitations">
      {invitations.map((invitation, index) => (
        <Item
          key={invitation.id}
          variant="outline"
          data-testid={`home-invitation-${invitation.id}`}
        >
          <ItemMedia variant="icon">
            <EnvelopeSimpleIcon />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle>
              Join {invitation.organizationName ?? invitation.organizationSlug ?? "an organization"}
            </ItemTitle>
            <ItemDescription>
              Invited as {invitation.role ?? "member"} · expires{" "}
              <LocalDate value={invitation.expiresAt} format="relative" />
            </ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Button
              className="flex-1 sm:flex-none"
              variant="ghost"
              disabled={busy}
              data-testid={`home-invitation-decline-${invitation.id}`}
              onClick={() => rejectMutation.mutate(invitation)}
            >
              Decline
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              variant={index === 0 ? "default" : "outline"}
              disabled={busy}
              data-testid={`home-invitation-accept-${invitation.id}`}
              onClick={() => acceptMutation.mutate(invitation)}
            >
              Accept
            </Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
