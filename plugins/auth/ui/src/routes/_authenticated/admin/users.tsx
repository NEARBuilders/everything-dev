import {
  DotsThreeIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  TicketIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { refreshSessionCache, requireAdmin, useAuthClient } from "everything-dev/ui/auth";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuthApiClient } from "@/lib/api";
import { AdminBanDialog, AdminRoleDialog, AdminSessionsDialog } from "./-admin-users-dialogs";
import type { AdminSession, AdminUser } from "./-admin-users-types";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({
    meta: [
      { title: "Users · Admin" },
      { name: "description", content: "Platform-wide user management." },
    ],
  }),
  beforeLoad: requireAdmin,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      adminUsersQueryOptions(context.apiClient.auth, { field: "email", value: "" }, 0),
    );
  },
  component: AdminUsers,
});

type AdminSearch = { field: "email" | "name"; value: string };

const PAGE_SIZE = 20;

function adminUsersQueryKey(search: AdminSearch, offset: number) {
  return ["admin-users", search.field, search.value, offset] as const;
}

function adminUsersQueryOptions(authApi: AuthApiClient, search: AdminSearch, offset: number) {
  return {
    queryKey: adminUsersQueryKey(search, offset),
    queryFn: () =>
      authApi.adminListUsers({
        ...(search.value.trim()
          ? { searchValue: search.value.trim(), searchField: search.field }
          : {}),
        limit: PAGE_SIZE,
        offset,
      }),
  };
}

function AdminUsers() {
  const auth = useAuthClient();
  const authApi = Route.useRouteContext().apiClient.auth;
  const queryClient = useQueryClient();
  const router = useRouter();

  const [search, setSearch] = useState<AdminSearch>({ field: "email", value: "" });
  const [offset, setOffset] = useState(0);
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [sessionsTarget, setSessionsTarget] = useState<AdminUser | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const usersQuery = useQuery(adminUsersQueryOptions(authApi, search, offset));
  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;

  const sessionsQuery = useQuery({
    queryKey: ["admin-users", "sessions", sessionsTarget?.id],
    queryFn: async (): Promise<AdminSession[]> => {
      if (!sessionsTarget) return [];
      const { sessions } = await authApi.adminListUserSessions({ userId: sessionsTarget.id });
      return sessions;
    },
    enabled: !!sessionsTarget,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: adminUsersQueryKey(search, offset) });

  const banMutation = useMutation({
    mutationFn: (input: { userId: string; banReason?: string; banExpiresIn?: number }) =>
      authApi.adminBanUser(input),
    onSuccess: async () => {
      setBanTarget(null);
      toast.success("User banned");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to ban user"),
  });

  const unbanMutation = useMutation({
    mutationFn: (userId: string) => authApi.adminUnbanUser({ userId }),
    onSuccess: async () => {
      toast.success("User unbanned");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to unban user"),
  });

  const setRoleMutation = useMutation({
    mutationFn: (input: { userId: string; role: "admin" | "user" }) => authApi.adminSetRole(input),
    onSuccess: async () => {
      setRoleTarget(null);
      toast.success("Role updated");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update role"),
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionToken: string) => authApi.adminRevokeUserSession({ sessionToken }),
    onSuccess: async () => {
      setRevokingToken(null);
      toast.success("Session revoked");
      if (sessionsTarget) {
        await queryClient.invalidateQueries({
          queryKey: ["admin-users", "sessions", sessionsTarget.id],
        });
      }
    },
    onError: (error: Error) => {
      setRevokingToken(null);
      toast.error(error.message || "Failed to revoke session");
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: (userId: string) => authApi.adminRevokeUserSessions({ userId }),
    onSuccess: async () => {
      toast.success("All sessions revoked");
      if (sessionsTarget) {
        await queryClient.invalidateQueries({
          queryKey: ["admin-users", "sessions", sessionsTarget.id],
        });
      }
    },
    onError: (error: Error) => toast.error(error.message || "Failed to revoke sessions"),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => authApi.adminRemoveUser({ userId }),
    onSuccess: async () => {
      setRemoveTarget(null);
      toast.success("User removed");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to remove user"),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await auth.admin.impersonateUser({ userId });
      if (error) throw new Error(error.message || "Failed to impersonate user");
    },
    onSuccess: async () => {
      toast.success("Impersonation active — you are now signed in as this user");
      await refreshSessionCache(auth, queryClient);
      await router.navigate({ to: "/dashboard" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to impersonate user"),
  });

  const isPending =
    banMutation.isPending ||
    unbanMutation.isPending ||
    setRoleMutation.isPending ||
    removeMutation.isPending;

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Platform-wide accounts. Search, promote, ban and clean up."
        headerTestId="admin-users.heading"
      />

      <div className="flex flex-wrap items-center gap-2" data-testid="admin-users.search">
        <Input
          value={search.value}
          onChange={(event) => {
            setSearch((prev) => ({ ...prev, value: event.target.value }));
            setOffset(0);
          }}
          placeholder={`Search by ${search.field}`}
          className="max-w-xs"
          data-testid="admin-users.search-input"
        />
        <Button
          variant={search.field === "name" ? "secondary" : "outline"}
          size="sm"
          onClick={() => {
            setSearch((prev) => ({
              field: prev.field === "email" ? "name" : "email",
              value: "",
            }));
            setOffset(0);
          }}
          data-testid="admin-users.search-field-toggle"
        >
          by {search.field}
        </Button>
      </div>

      {usersQuery.isPending ? (
        <div className="flex flex-col gap-3" data-testid="admin-users.loading">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : usersQuery.isError ? (
        <EmptyState
          icon={ProhibitIcon}
          title="Couldn't load users"
          description="Check your connection and try again."
          action={
            <Button
              variant="outline"
              onClick={() => void usersQuery.refetch()}
              data-testid="admin-users.retry-button"
            >
              Try again
            </Button>
          }
        />
      ) : users.length === 0 ? (
        <EmptyState
          icon={UserCircleIcon}
          title="No users found"
          description={
            search.value.trim() ? "No account matches that search." : "No accounts exist yet."
          }
        />
      ) : (
        <ItemGroup data-testid="admin-users.list">
          {users.map((user) => (
            <Item key={user.id} variant="outline" size="sm" role="listitem">
              <ItemMedia variant="icon">
                {user.image ? (
                  <img src={user.image} alt="" className="size-6 rounded-full" />
                ) : (
                  <UserCircleIcon />
                )}
              </ItemMedia>
              <ItemContent className="basis-0">
                <ItemTitle className="max-w-full">
                  <span className="min-w-0 truncate">{user.name || "Unnamed"}</span>
                </ItemTitle>
                <ItemDescription>
                  <span className="truncate">{user.email}</span>
                  {" · "}
                  joined <LocalDate value={user.createdAt} format="relative" />
                </ItemDescription>
              </ItemContent>
              <ItemActions className="hidden flex-wrap justify-end sm:flex">
                {user.role === "admin" && <Badge>Admin</Badge>}
                {user.banned ? <Badge variant="destructive">Banned</Badge> : null}
                {user.isAnonymous ? <Badge variant="outline">Anonymous</Badge> : null}
              </ItemActions>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${user.name || user.email}`}
                        data-testid={`admin-users.menu-${user.id}`}
                      />
                    }
                  >
                    <DotsThreeIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRoleTarget(user)}>
                      <ShieldCheckIcon />
                      Set role
                    </DropdownMenuItem>
                    {user.banned ? (
                      <DropdownMenuItem
                        onClick={() => unbanMutation.mutate(user.id)}
                        data-testid="admin-users.unban-action"
                      >
                        <ProhibitIcon />
                        Unban
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => setBanTarget(user)}>
                        <ProhibitIcon />
                        Ban
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setSessionsTarget(user)}>
                      <TicketIcon />
                      Sessions
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => impersonateMutation.mutate(user.id)}
                      disabled={impersonateMutation.isPending}
                    >
                      <UserCircleIcon />
                      Impersonate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setRemoveTarget(user)}>
                      <TrashIcon />
                      Remove user
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2" data-testid="admin-users.pagination">
          <span className="text-sm text-muted-foreground">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            data-testid="admin-users.prev"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            data-testid="admin-users.next"
          >
            Next
          </Button>
        </div>
      )}

      <AdminBanDialog
        user={banTarget}
        open={!!banTarget}
        onOpenChange={(open) => {
          if (!open) setBanTarget(null);
        }}
        onBan={(input) => banMutation.mutate(input)}
        isPending={isPending}
      />
      <AdminRoleDialog
        user={roleTarget}
        open={!!roleTarget}
        onOpenChange={(open) => {
          if (!open) setRoleTarget(null);
        }}
        onSetRole={(input) => setRoleMutation.mutate(input)}
        isPending={isPending}
      />
      <AdminSessionsDialog
        userId={sessionsTarget?.id ?? null}
        open={!!sessionsTarget}
        onOpenChange={(open) => {
          if (!open) setSessionsTarget(null);
        }}
        sessions={sessionsQuery.data ?? []}
        isLoading={sessionsQuery.isPending}
        revokingToken={revokingToken}
        isRevokingAll={revokeAllMutation.isPending}
        onRevokeSession={(sessionToken) => {
          setRevokingToken(sessionToken);
          revokeSessionMutation.mutate(sessionToken);
        }}
        onRevokeAll={() => {
          if (sessionsTarget) revokeAllMutation.mutate(sessionsTarget.id);
        }}
      />
      {removeTarget && (
        <ConfirmRemoveDialog
          user={removeTarget}
          isPending={removeMutation.isPending}
          onConfirm={() => removeMutation.mutate(removeTarget.id)}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
        />
      )}
    </PageContainer>
  );
}

function ConfirmRemoveDialog({
  user,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  user: AdminUser;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Remove ${user.name || user.email || "this user"}?`}
      description="Their account, sessions and linked accounts are deleted permanently. This cannot be undone."
      confirmLabel="Remove user"
      variant="destructive"
      isPending={isPending}
      onConfirm={onConfirm}
    />
  );
}
