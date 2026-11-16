import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ApiClient, pluginPath } from "@/app";
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

export type HomeInvitation = Awaited<ReturnType<ApiClient["auth"]["listUserInvitations"]>>[number];

export function InvitationSteps({ invitations }: { invitations: HomeInvitation[] }) {
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
              variant={index === 0 ? "default" : "outline"}
              nativeButton={false}
              render={<Link to={pluginPath(`/orgs/invites/${invitation.id}`)} />}
              data-testid={`home-invitation-review-${invitation.id}`}
            >
              Review
            </Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
