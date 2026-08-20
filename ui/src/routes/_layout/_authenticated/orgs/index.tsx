import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Building2, Mail, Plus, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import {
  type Organization,
  type SessionData,
  sessionQueryOptions,
  useApiClient,
  useAuthClient,
} from "@/app";
import { Button, Card } from "@/components";
import { PageContainer } from "@/components/layout/page-container";

type AuthClientType = import("@/app").AuthClient;
type UserInvitationsResponse = Awaited<
  ReturnType<AuthClientType["organization"]["listUserInvitations"]>
>;
type UserInvitationItem = NonNullable<UserInvitationsResponse["data"]>[number];

export const Route = createFileRoute("/_layout/_authenticated/orgs/")({
  head: () => ({
    title: "Organizations | auth.everything.dev",
    meta: [{ name: "description", content: "Manage your organizations and teams." }],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(
      sessionQueryOptions(context.authClient, context.session),
    );
    await context.queryClient.ensureQueryData({
      queryKey: ["organizations"],
      queryFn: async () => {
        const { data } = await context.authClient.organization.list();
        return (data || []) as Organization[];
      },
      staleTime: 30 * 1000,
    });
    await context.queryClient.ensureQueryData({
      queryKey: ["user-invitations"],
      queryFn: async (): Promise<UserInvitationItem[]> => {
        const { data, error } = await context.authClient.organization.listUserInvitations();
        if (error) throw new Error(error.message);
        return (data ?? []) as UserInvitationItem[];
      },
      staleTime: 30 * 1000,
    });
  },
  component: OrganizationsList,
});

function OrganizationsList() {
  const auth = useAuthClient();
  const apiClient = useApiClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useQuery<SessionData | null>({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await auth.getSession();
      return data ?? null;
    },
    staleTime: 60 * 1000,
  });
  const { data: organizations, isLoading } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
  });

  const { data: userInvitations = [] } = useQuery({
    queryKey: ["user-invitations"],
    queryFn: async (): Promise<UserInvitationItem[]> => {
      const { data, error } = await auth.organization.listUserInvitations();
      if (error) throw new Error(error.message);
      return (data ?? []) as UserInvitationItem[];
    },
    staleTime: 30 * 1000,
  });

  const orgs = organizations || [];

  const { data: tenantOrgIds = new Set<string>() } = useQuery({
    queryKey: ["tenant-orgs", orgs.map((o) => o.id)],
    queryFn: async () => {
      const results = await Promise.allSettled(
        orgs.map((o) => apiClient.resolveTenantByOrgId({ orgId: o.id })),
      );
      return new Set(orgs.filter((_, i) => results[i]?.status === "fulfilled").map((o) => o.id));
    },
    enabled: orgs.length > 0,
    staleTime: 60 * 1000,
  });

  const pendingInvitations = userInvitations.filter((i) => i.status === "pending");

  const acceptInvitationMutation = useMutation({
    mutationFn: async (invitation: UserInvitationItem) => {
      const { error } = await auth.organization.acceptInvitation({
        invitationId: invitation.id,
      });
      if (error) throw new Error(error.message);
      return invitation;
    },
    onSuccess: async (invitation) => {
      toast.success(`Joined ${invitation.organizationName ?? "organization"}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["user-invitations"] }),
      ]);
      await queryClient.refetchQueries({ queryKey: ["organizations"] });
      if (invitation.organizationSlug) {
        await router.navigate({
          to: "/orgs/$slug",
          params: { slug: invitation.organizationSlug },
        });
      }
    },
    onError: (error: Error) => toast.error(error.message || "Failed to accept invitation"),
  });

  const rejectInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await auth.organization.rejectInvitation({ invitationId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Invitation declined");
      await queryClient.invalidateQueries({ queryKey: ["user-invitations"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to decline invitation"),
  });

  const user = session?.user;
  const activeOrgId = session?.session?.activeOrganizationId;

  const switchOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await auth.organization.setActive({ organizationId: orgId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Switched organization");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to switch organization"),
  });

  return (
    <PageContainer variant="wide">
      <div className="space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3 w-3" />
            Teams
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Organizations
              </h1>
            </div>
            <Link
              to="/orgs/new"
              className="h-10 px-4 inline-flex items-center gap-1.5 text-sm font-semibold border-2 border-outset border-border-strong bg-foreground text-background shadow-sm hover:shadow-md active:border-inset active:shadow-none transition-all duration-200 ease-out rounded-[12px]"
            >
              <Plus size={14} />
              new
            </Link>
          </div>
        </header>

        <div className="space-y-6">
          {pendingInvitations.length > 0 && (
            <section className="space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Pending Invitations ({pendingInvitations.length})
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {pendingInvitations.map((invitation) => (
                  <Card key={invitation.id} className="p-6 space-y-4 hover:shadow-md">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-[10px] border border-border bg-muted flex items-center justify-center shrink-0">
                        <Mail className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="text-base font-semibold text-foreground break-all">
                          {invitation.organizationName ?? invitation.organizationSlug}
                        </div>
                        <div className="text-sm text-muted-foreground font-mono">
                          invited as {invitation.role ?? "member"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          expires {new Date(invitation.expiresAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => acceptInvitationMutation.mutate(invitation)}
                        disabled={
                          acceptInvitationMutation.isPending || rejectInvitationMutation.isPending
                        }
                      >
                        {acceptInvitationMutation.isPending &&
                        acceptInvitationMutation.variables?.id === invitation.id
                          ? "accepting..."
                          : "accept"}
                      </Button>
                      <Button
                        onClick={() => rejectInvitationMutation.mutate(invitation.id)}
                        disabled={
                          acceptInvitationMutation.isPending || rejectInvitationMutation.isPending
                        }
                        variant="outline"
                      >
                        {rejectInvitationMutation.isPending &&
                        rejectInvitationMutation.variables === invitation.id
                          ? "declining..."
                          : "decline"}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2">
              {[1, 2].map((n) => (
                <Card key={n} className="p-6 space-y-5">
                  <div className="flex items-start gap-4">
                    <div className="h-14 w-14 rounded-[10px] animate-pulse bg-muted shrink-0" />
                    <div className="space-y-2 flex-1 pt-1">
                      <div className="h-5 w-3/4 rounded-[4px] animate-pulse bg-muted" />
                      <div className="h-4 w-1/2 rounded-[4px] animate-pulse bg-muted" />
                    </div>
                  </div>
                  <div className="h-10 w-full rounded-[8px] animate-pulse bg-muted" />
                  <div className="flex gap-2">
                    <div className="h-10 w-24 rounded-[12px] animate-pulse bg-muted" />
                    <div className="h-10 w-24 rounded-[12px] animate-pulse bg-muted" />
                  </div>
                </Card>
              ))}
            </div>
          ) : orgs.length === 0 ? (
            <Card className="p-10 text-center space-y-4 items-center">
              <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-base font-semibold text-foreground">No organizations yet.</p>
              <Link
                to="/orgs/new"
                className="h-10 px-4 inline-flex items-center gap-1.5 text-sm font-semibold border-2 border-outset border-border-strong bg-foreground text-background shadow-sm hover:shadow-md active:border-inset active:shadow-none transition-all duration-200 ease-out rounded-[12px]"
              >
                create your first org
              </Link>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {orgs.map((org: Organization) => {
                const isActive = org.id === activeOrgId;
                const isPersonal = user
                  ? org.slug === user.id || org.metadata?.isPersonal === true
                  : false;
                const hasTenant = tenantOrgIds.has(org.id);

                return (
                  <Card key={org.id} className="p-6 space-y-5 hover:shadow-md">
                    <div className="flex items-start gap-4">
                      {org.logo ? (
                        <img
                          src={org.logo}
                          alt=""
                          className="w-14 h-14 rounded-[10px] border border-border object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-[10px] border border-border bg-muted flex items-center justify-center text-xl font-bold text-foreground shrink-0">
                          {org.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 space-y-1.5 flex-1 pt-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-foreground break-all leading-tight">
                            {org.name}
                          </span>
                          {isActive && <Chip>active</Chip>}
                          {isPersonal && <Chip>personal</Chip>}
                          {hasTenant && <Chip>tenant</Chip>}
                        </div>
                        <div className="text-sm font-mono text-muted-foreground">@{org.slug}</div>
                      </div>
                    </div>

                    <div className="rounded-[8px] border border-border bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                      {org.createdAt
                        ? `created ${new Date(org.createdAt).toLocaleDateString()}`
                        : "organization record"}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button asChild>
                        <Link to="/orgs/$slug" params={{ slug: org.slug }}>
                          open org
                        </Link>
                      </Button>
                      {!isActive && (
                        <Button
                          onClick={() => switchOrgMutation.mutate(org.id)}
                          disabled={switchOrgMutation.isPending}
                          variant="outline"
                        >
                          <RefreshCw className="h-4 w-4" />
                          switch
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <Card className="p-5 text-sm text-muted-foreground leading-relaxed">
            Each user gets a personal organization automatically. Additional organizations give
            teams their own members, invitations, and API key scope.
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[6px] px-2.5 py-0.5 text-[11px] font-semibold border bg-secondary border-border text-foreground">
      {children}
    </span>
  );
}
