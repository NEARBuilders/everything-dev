import { UserMinusIcon } from "@phosphor-icons/react";
import { Avatar, AvatarFallback, AvatarImage, Badge } from "@/components";
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

export interface MemberCardMember {
  id: string;
  userId: string;
  role: string;
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

export function memberDisplayName(member: MemberCardMember | undefined, fallback: string) {
  return member?.user?.name || member?.user?.email || fallback;
}

export function MemberAvatar({
  member,
  fallback,
  size = "default",
}: {
  member: MemberCardMember | undefined;
  fallback: string;
  size?: "default" | "sm" | "lg";
}) {
  const name = memberDisplayName(member, fallback);
  return (
    <Avatar size={size}>
      {member?.user?.image ? <AvatarImage src={member.user.image} alt="" /> : null}
      <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

export function MemberRow({
  canManage,
  isSelf,
  member,
  onRemove,
}: {
  member: MemberCardMember;
  canManage: boolean;
  isSelf?: boolean;
  onRemove?: () => void;
}) {
  const name = memberDisplayName(member, member.userId);
  const secondary = member.user?.name && member.user.email ? member.user.email : member.userId;

  return (
    <Item size="sm" data-testid={`org-member-${member.userId}`}>
      <ItemMedia>
        <MemberAvatar member={member} fallback={member.userId} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="min-w-0 truncate">{name}</span>
          {isSelf && <span className="shrink-0 text-muted-foreground">(you)</span>}
        </ItemTitle>
        <ItemDescription>
          <span className="font-mono break-all">{secondary}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Badge variant={member.role === "member" ? "outline" : "secondary"}>
          {roleLabel(member.role)}
        </Badge>
        {canManage && onRemove ? (
          <RowMenu label={`Actions for ${name}`}>
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <UserMinusIcon />
              Remove from organization
            </DropdownMenuItem>
          </RowMenu>
        ) : (
          <span className="size-11" aria-hidden />
        )}
      </ItemActions>
    </Item>
  );
}
