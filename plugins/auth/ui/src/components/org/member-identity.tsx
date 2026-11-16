import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { isSyntheticEmail } from "@/lib/synthetic-email";

export interface MemberIdentityUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export interface MemberIdentityMember {
  userId: string;
  user?: MemberIdentityUser | null;
}

function realEmail(email: string | null | undefined): string | null {
  if (!email || isSyntheticEmail(email)) return null;
  return email;
}

export function memberDisplayName(member: MemberIdentityMember | undefined, fallback: string) {
  return member?.user?.name || realEmail(member?.user?.email) || fallback;
}

export function memberSecondaryLine(member: MemberIdentityMember) {
  return member.user?.name ? (realEmail(member.user.email) ?? member.userId) : member.userId;
}

export function MemberIdentity({
  member,
  isSelf,
}: {
  member: MemberIdentityMember;
  isSelf?: boolean;
}) {
  const name = memberDisplayName(member, member.userId);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar>
        {member.user?.image ? <AvatarImage src={member.user.image} alt="" /> : null}
        <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="min-w-0 truncate font-medium text-foreground">
          {name}
          {isSelf && <span className="ml-1.5 font-normal text-muted-foreground">(you)</span>}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {memberSecondaryLine(member)}
        </span>
      </div>
    </div>
  );
}
