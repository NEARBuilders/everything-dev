import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Building2, Home, LogOut, Settings, User } from "lucide-react";
import { useMemo } from "react";
import type { Organization } from "@/app";
import { sessionQueryOptions, useAuthClient } from "@/app";
import { Avatar, AvatarFallback, AvatarImage, OrgSwitcher } from "@/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNearInitials, resolveNearImageUrl } from "@/lib/near-profile";

export function UserNav() {
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const { data: session } = useQuery(sessionQueryOptions(auth));
  const user = session?.user;
  const nearAccountId = auth.near.getAccountId();

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
    enabled: !!user,
  });
  const activeOrgId = session?.session?.activeOrganizationId;

  const activeOrg = useMemo(() => {
    return organizations?.find((org) => org.id === activeOrgId);
  }, [organizations, activeOrgId]);

  const { data: nearProfile } = useQuery({
    queryKey: ["near-profile", nearAccountId],
    queryFn: async () => {
      const { data } = await auth.near.getProfile(nearAccountId ?? undefined);
      return data ?? null;
    },
    enabled: !!nearAccountId,
    staleTime: 5 * 60 * 1000,
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.signOut();
      if (error) {
        throw new Error(error.message || "Failed to sign out");
      }
      await auth.near.disconnect().catch(() => {});
    },
    onSuccess: async () => {
      queryClient.setQueryData(["session"], null);
      queryClient.removeQueries({ queryKey: ["organizations"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await router.invalidate();
      await navigate({ to: "/", replace: true });
    },
    onError: (error: Error) => {
      console.error("Sign out error:", error);
    },
  });

  if (!user) {
    return (
      <Link
        to="/login"
        className="h-9 px-4 inline-flex items-center justify-center text-sm font-medium border-2 border-outset border-border-strong bg-card text-foreground shadow-sm hover:shadow-md hover:bg-muted active:border-inset active:shadow-none transition-all duration-200 ease-out cursor-pointer"
      >
        connect
      </Link>
    );
  }

  const handleOrgSwitch = async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries({ queryKey: ["organizations"] });
  };

  const avatarSrc = resolveNearImageUrl(nearProfile?.image) ?? user.image ?? undefined;
  const validEmail = !user.isAnonymous && user.email ? user.email : null;
  const displayName = nearProfile?.name || user.name || nearAccountId || validEmail || "guest";
  const handle = nearAccountId || validEmail || "anonymous session";
  const showHandle = handle !== displayName;
  const initials = getNearInitials(nearProfile?.name || user.name || nearAccountId);

  const identityContent = (
    <>
      <Avatar className="size-9 shrink-0 ring-1 ring-border">
        {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
        <AvatarFallback className="text-xs font-semibold">
          {initials || <User className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
        {showHandle && <p className="truncate text-xs text-muted-foreground">{handle}</p>}
      </div>
    </>
  );

  return (
    <div className="flex items-center gap-2">
      {organizations && organizations.length > 0 && (
        <OrgSwitcher
          organizations={organizations}
          activeOrgId={activeOrgId}
          onSwitch={handleOrgSwitch}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={displayName}
            className="rounded-full! ring-1 ring-border transition-transform duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:scale-105"
            title="account menu"
          >
            <Avatar className="size-8">
              {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
              <AvatarFallback className="text-xs font-semibold">
                {initials || <User className="size-4" />}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem asChild>
            {nearAccountId ? (
              <Link to="/$accountId" params={{ accountId: nearAccountId }}>
                {identityContent}
              </Link>
            ) : (
              <Link to="/settings/profile">{identityContent}</Link>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/dashboard">
              <Home />
              workspace
            </Link>
          </DropdownMenuItem>
          {activeOrg && (
            <DropdownMenuItem asChild>
              <Link to="/orgs/$slug" params={{ slug: activeOrg.slug }}>
                <Building2 />
                {activeOrg.name}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings />
              settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault();
              signOutMutation.mutate();
            }}
            disabled={signOutMutation.isPending}
          >
            <LogOut />
            {signOutMutation.isPending ? "signing out..." : "sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
