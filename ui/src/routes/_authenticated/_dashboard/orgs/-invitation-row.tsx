import {
  ArrowsClockwiseIcon,
  EnvelopeSimpleIcon,
  WalletIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { LocalDate } from "@/components";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { roleLabel } from "./-org-avatar";
import { RowMenu } from "./-row-menu";

export interface InvitationRowInvitation {
  id: string;
  email: string;
  nearAccountId?: string | null;
  nearNetwork?: "mainnet" | "testnet" | null;
  role: string | null;
  status: string;
  expiresAt: string | Date;
  teamId?: string | null;
}

export function InvitationRow({
  invitation,
  isCancelling,
  isResending,
  onCancel,
  onResend,
  teamName,
}: {
  invitation: InvitationRowInvitation;
  teamName?: string;
  onResend?: () => void;
  onCancel?: () => void;
  isResending?: boolean;
  isCancelling?: boolean;
}) {
  const needsReissue = !!invitation.nearAccountId && !invitation.nearNetwork;
  const identifier = invitation.nearAccountId ?? invitation.email;
  const canResend = !!onResend && !needsReissue;

  return (
    <Item size="sm" data-testid={`invitation-${invitation.id}`}>
      <ItemMedia variant="icon">
        {invitation.nearAccountId ? <WalletIcon /> : <EnvelopeSimpleIcon />}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="break-all">{identifier}</ItemTitle>
        <ItemDescription>
          {roleLabel(invitation.role)}
          {teamName && (
            <span data-testid={`invitation-team-${invitation.id}`}> · {teamName} team</span>
          )}
          {invitation.nearAccountId && !needsReissue && (
            <span data-testid={`invitation-network-${invitation.id}`}>
              {" "}
              · {invitation.nearNetwork}
            </span>
          )}{" "}
          · expires <LocalDate value={invitation.expiresAt} format="relative" />
        </ItemDescription>
        {needsReissue && (
          <p
            className="text-sm text-warning-muted-foreground"
            data-testid={`invitation-network-${invitation.id}`}
          >
            Network unknown. Cancel and reissue this invitation with an explicit network.
          </p>
        )}
      </ItemContent>
      {(canResend || onCancel) && (
        <ItemActions>
          <RowMenu label={`Actions for ${identifier}`} testId={`invitation-menu-${invitation.id}`}>
            {canResend && (
              <DropdownMenuItem onClick={onResend} disabled={isResending}>
                <ArrowsClockwiseIcon />
                Resend
              </DropdownMenuItem>
            )}
            {onCancel && (
              <DropdownMenuItem variant="destructive" onClick={onCancel} disabled={isCancelling}>
                <XCircleIcon />
                Cancel invitation
              </DropdownMenuItem>
            )}
          </RowMenu>
        </ItemActions>
      )}
    </Item>
  );
}
