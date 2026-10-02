import { GearIcon, SignOutIcon, UserCircleIcon, UserIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { Organization } from "@/app";
import { pluginPath } from "@/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface SignOutMutationLike {
  mutate: () => void;
  isPending: boolean;
}

interface UserNavMenuContentProps {
  nearAccountId: string | null | undefined;
  activeOrg?: Organization | undefined;
  avatarSrc: string | undefined;
  displayName: string;
  handle: string;
  showHandle: boolean;
  initials: string;
  signOutMutation: SignOutMutationLike;
  className?: string;
  align?: "start" | "end" | "center";
}

export function UserNavMenuContent({
  nearAccountId,
  avatarSrc,
  displayName,
  handle,
  showHandle,
  initials,
  signOutMutation,
  className = "w-64",
  align = "end",
}: UserNavMenuContentProps) {
  return (
    <DropdownMenuContent className={className} align={align}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
              <AvatarFallback>{initials || <UserIcon className="size-4" />}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
              {showHandle && (
                <span className="truncate text-xs text-muted-foreground">{handle}</span>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {nearAccountId && (
          <DropdownMenuItem
            render={<Link to="/$accountId" params={{ accountId: nearAccountId }} />}
            data-testid="account.profile-menuitem"
          >
            <UserCircleIcon />
            Your profile
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          render={<Link to={pluginPath("/settings")} />}
          data-testid="account.settings-menuitem"
        >
          <GearIcon />
          Settings
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        closeOnClick={false}
        onClick={() => signOutMutation.mutate()}
        disabled={signOutMutation.isPending}
        data-testid="account.signout-menuitem"
      >
        <SignOutIcon />
        {signOutMutation.isPending ? "Signing out…" : "Sign out"}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
