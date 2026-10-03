import { DownloadSimpleIcon, UserPlusIcon, UsersIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button, ConfirmDialog, EmptyState, SectionHeader, TabsContent } from "@/components";
import { ItemGroup, ItemSeparator } from "@/components/ui/item";
import { type MemberCardMember, MemberRow, memberDisplayName } from "./-member-card";

export function MembersTab({
  canManageMembers,
  canExportEmails,
  isExportingEmails,
  isRemoving,
  members,
  onExportEmails,
  onInvite,
  onRemove,
  sessionUserId,
}: {
  canManageMembers: boolean;
  canExportEmails?: boolean;
  isExportingEmails?: boolean;
  isRemoving: boolean;
  members: MemberCardMember[];
  onExportEmails?: () => void;
  onInvite?: () => void;
  onRemove: (member: MemberCardMember) => void;
  sessionUserId: string | undefined;
}) {
  const [removing, setRemoving] = useState<MemberCardMember | null>(null);

  return (
    <TabsContent value="members" className="flex flex-col gap-6 pt-6">
      <SectionHeader
        title="Members"
        action={
          <div className="flex items-center gap-2">
            {canExportEmails && onExportEmails ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onExportEmails}
                disabled={isExportingEmails}
                data-testid="org-members-export-emails"
              >
                <DownloadSimpleIcon />
                Export emails
              </Button>
            ) : null}
            {canManageMembers && onInvite ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onInvite}
                data-testid="org-members-invite"
              >
                <UserPlusIcon />
                Invite people
              </Button>
            ) : null}
          </div>
        }
      />
      {members.length > 0 ? (
        <ItemGroup>
          {members.map((member, index) => (
            <div key={member.id} className="flex flex-col">
              {index > 0 && <ItemSeparator />}
              <MemberRow
                member={member}
                isSelf={member.userId === sessionUserId}
                canManage={canManageMembers && member.userId !== sessionUserId}
                onRemove={() => setRemoving(member)}
              />
            </div>
          ))}
        </ItemGroup>
      ) : (
        <EmptyState icon={UsersIcon} title="No members yet" />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? memberDisplayName(removing, removing.userId) : ""}?`}
        description="They lose access to this organization and its teams."
        confirmLabel="Remove"
        variant="destructive"
        isPending={isRemoving}
        onConfirm={() => {
          if (removing) onRemove(removing);
          setRemoving(null);
        }}
      />
    </TabsContent>
  );
}
