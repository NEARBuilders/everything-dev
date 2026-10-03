import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ConfirmDialog, EmptyState, SectionHeader, TabsContent } from "@/components";
import { ItemGroup, ItemSeparator } from "@/components/ui/item";
import { InvitationRow, type InvitationRowInvitation } from "./-invitation-row";
import { InviteMemberForm, type InviteMemberValues } from "./-invite-member-form";

export function InvitationsTab({
  canManageMembers,
  invitePending,
  invitations,
  isPersonal,
  onCancel,
  onInvite,
  onResend,
  isCancelling,
  isResending,
  teams,
}: {
  canManageMembers: boolean;
  invitePending: boolean;
  invitations: InvitationRowInvitation[];
  isPersonal: boolean;
  onCancel: (id: string) => void;
  onInvite: (values: InviteMemberValues) => Promise<unknown>;
  onResend: (invitation: InvitationRowInvitation) => void;
  isCancelling: boolean;
  isResending: boolean;
  teams: Array<{ id: string; name: string }>;
}) {
  const [cancelling, setCancelling] = useState<InvitationRowInvitation | null>(null);
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const canInvite = canManageMembers && !isPersonal;

  return (
    <TabsContent value="invitations" className="flex flex-col gap-12 pt-6">
      {canInvite && (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Invite people" />
          <InviteMemberForm teams={teams} isPending={invitePending} onInvite={onInvite} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeader title={`Pending (${pendingInvitations.length})`} />
        {pendingInvitations.length > 0 ? (
          <ItemGroup>
            {pendingInvitations.map((invitation, index) => (
              <div key={invitation.id} className="flex flex-col">
                {index > 0 && <ItemSeparator />}
                <InvitationRow
                  invitation={invitation}
                  teamName={invitation.teamId ? teamNames.get(invitation.teamId) : undefined}
                  onCancel={canManageMembers ? () => setCancelling(invitation) : undefined}
                  onResend={canManageMembers ? () => onResend(invitation) : undefined}
                  isCancelling={isCancelling}
                  isResending={isResending}
                />
              </div>
            ))}
          </ItemGroup>
        ) : (
          <EmptyState icon={EnvelopeSimpleIcon} title="No pending invitations" className="py-10" />
        )}
      </section>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this invitation?"
        description={`${cancelling?.nearAccountId ?? cancelling?.email ?? ""} will no longer be able to join with it.`}
        confirmLabel="Cancel invitation"
        cancelLabel="Keep"
        variant="destructive"
        isPending={isCancelling}
        onConfirm={() => {
          if (cancelling) onCancel(cancelling.id);
          setCancelling(null);
        }}
      />
    </TabsContent>
  );
}
