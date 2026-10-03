import { Avatar, AvatarFallback, AvatarImage } from "@/components";

export function OrgAvatar({
  name,
  logo,
  size = "default",
}: {
  name: string;
  logo?: string | null;
  size?: "default" | "sm" | "lg";
}) {
  return (
    <Avatar size={size}>
      {logo ? <AvatarImage src={logo} alt="" /> : null}
      <AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

export function roleLabel(role: string | null | undefined) {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}
