import { UserIcon } from "@phosphor-icons/react";
import { ClientOnly, Link } from "@tanstack/react-router";
import { pluginPath } from "@/app";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAppTranslation } from "@/i18n/runtime";
import { useIdentity } from "./use-identity";
import { UserNavMenuContent } from "./user-nav-menu";

interface UserNavProps {
  showSignIn?: boolean;
}

export function UserNav({ showSignIn = true }: UserNavProps) {
  return (
    <ClientOnly>
      <UserNavContent showSignIn={showSignIn} />
    </ClientOnly>
  );
}

export function SignInButton() {
  const t = useAppTranslation();
  return (
    <Button
      nativeButton={false}
      render={<Link to={pluginPath("/login")} />}
      data-testid="public-header-signin"
    >
      {t("nav.signIn")}
    </Button>
  );
}

function UserNavContent({ showSignIn }: UserNavProps) {
  const t = useAppTranslation();
  const {
    user,
    isSessionLoading,
    signOutMutation,
    avatarSrc,
    displayName,
    handle,
    showHandle,
    initials,
  } = useIdentity();

  if (isSessionLoading) return null;

  if (!user) return showSignIn ? <SignInButton /> : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={displayName}
        data-testid="account-menu"
        render={<Button variant="ghost" size="icon" />}
        title={t("nav.account")}
      >
        <Avatar>
          {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
          <AvatarFallback>{initials || <UserIcon className="size-4" />}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <UserNavMenuContent
        avatarSrc={avatarSrc}
        displayName={displayName}
        handle={handle}
        showHandle={showHandle}
        initials={initials}
        signOutMutation={signOutMutation}
        align="end"
      />
    </DropdownMenu>
  );
}
