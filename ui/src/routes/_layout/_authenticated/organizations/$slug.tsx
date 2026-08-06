import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  Building2,
  Edit2,
  Key,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  Trash2,
  User,
  UserCog,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type Organization, type SessionData, sessionQueryOptions, useAuthClient } from "@/app";
import {
  ApiKeyForm,
  type ApiKeyFormValues,
  ApiKeyReveal,
  type ApiKeyRevealProps,
  Badge,
  Button,
  Card,
  CardContent,
  InfoRow,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { EmptyState as SharedEmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";

type AuthClientType = import("@/app").AuthClient;

type MembersResponse = Awaited<ReturnType<AuthClientType["organization"]["listMembers"]>>;
type MemberItem = NonNullable<MembersResponse["data"]>["members"][number];

type InvitationsResponse = Awaited<ReturnType<AuthClientType["organization"]["listInvitations"]>>;
type InvitationItem = NonNullable<InvitationsResponse["data"]>[number];

type ApiKeyItem = {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  createdAt: string | Date;
  expiresAt?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};

type CreatedApiKey = ApiKeyRevealProps["apiKey"];

const orgMembersQueryKey = (orgId: string) => ["org-members", orgId] as const;
const orgInvitationsQueryKey = (orgId: string) => ["org-invitations", orgId] as const;
const orgApiKeysQueryKey = (orgId: string) => ["org-api-keys", orgId] as const;

export const Route = createFileRoute("/_layout/_authenticated/organizations/$slug")({
  head: () => ({
    title: "Organization | auth.everything.dev",
    meta: [{ name: "description", content: "Manage organization details and members." }],
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
  },
  component: OrganizationDetail,
});

function OrganizationDetail() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { slug: orgSlug } = Route.useParams();
  const auth = useAuthClient();

  const { data: session } = useQuery<SessionData | null>({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await auth.getSession();
      return data ?? null;
    },
    staleTime: 60 * 1000,
  });

  const { data: organizations = [], isLoading: isLoadingOrgs } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data } = await auth.organization.list();
      return (data || []) as Organization[];
    },
    staleTime: 30 * 1000,
  });

  const org = organizations.find((o: Organization) => o.slug === orgSlug);
  const orgId = org?.id ?? "";
  const activeOrgId = session?.session?.activeOrganizationId;
  const isActive = orgId === activeOrgId;

  const members =
    useQuery({
      queryKey: orgMembersQueryKey(orgId),
      queryFn: async (): Promise<MemberItem[]> => {
        const { data, error } = await auth.organization.listMembers({
          query: { organizationId: orgId },
        });
        if (error) throw new Error(error.message);
        return (data?.members ?? []) as MemberItem[];
      },
      enabled: !!orgId,
    }).data ?? [];

  const invitations =
    useQuery({
      queryKey: orgInvitationsQueryKey(orgId),
      queryFn: async (): Promise<InvitationItem[]> => {
        const { data, error } = await auth.organization.listInvitations({
          query: { organizationId: orgId },
        });
        if (error) throw new Error(error.message);
        return (data ?? []) as InvitationItem[];
      },
      enabled: !!orgId,
    }).data ?? [];

  const apiKeys =
    useQuery({
      queryKey: orgApiKeysQueryKey(orgId),
      queryFn: async (): Promise<ApiKeyItem[]> => {
        const { data, error } = await auth.apiKey.list({
          query: { configId: "org-keys", organizationId: orgId },
        });
        if (error) throw new Error(error.message);
        return (data?.apiKeys ?? []) as ApiKeyItem[];
      },
      enabled: !!orgId,
    }).data ?? [];

  const myMembership = members.find((m) => m.userId === session?.user?.id);
  const canManageMembers = myMembership?.role === "owner" || myMembership?.role === "admin";
  const isOwner = myMembership?.role === "owner";

  const pendingInvitationsCount = invitations.filter((i) => i.status === "pending").length;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);

  const handleCopyApiKey = async (value: string, message = "API key copied") => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("Failed to copy API key");
    }
  };

  const switchOrgMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.setActive({ organizationId: orgId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Switched to this organization");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to switch organization"),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.inviteMember({
        organizationId: orgId,
        email: inviteEmail,
        role: inviteRole,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      await queryClient.invalidateQueries({ queryKey: orgInvitationsQueryKey(orgId) });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send invitation");
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await auth.organization.cancelInvitation({ invitationId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Invitation cancelled");
      await queryClient.invalidateQueries({ queryKey: orgInvitationsQueryKey(orgId) });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to cancel invitation");
    },
  });

  const resendInvitationMutation = useMutation({
    mutationFn: async (invitation: InvitationItem) => {
      const { error } = await auth.organization.inviteMember({
        organizationId: orgId,
        email: invitation.email,
        role: invitation.role as "admin" | "member" | "owner",
        resend: true,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Invitation resent");
      await queryClient.invalidateQueries({ queryKey: orgInvitationsQueryKey(orgId) });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to resend invitation");
    },
  });

  const createApiKeyMutation = useMutation({
    mutationFn: async (values: ApiKeyFormValues) => {
      const { data, error } = await auth.apiKey.create({
        configId: "org-keys",
        organizationId: orgId,
        name: values.name,
        ...(values.expiresIn !== undefined ? { expiresIn: values.expiresIn } : {}),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (data) => {
      if (data) setCreatedApiKey(data as CreatedApiKey);
      toast.success("API key created");
      await queryClient.invalidateQueries({ queryKey: orgApiKeysQueryKey(orgId) });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create API key");
    },
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await auth.apiKey.delete({ keyId, configId: "org-keys" });
      if (error) throw new Error(error.message);
    },
    onMutate: async (keyId) => {
      await queryClient.cancelQueries({ queryKey: orgApiKeysQueryKey(orgId) });
      const previousKeys = queryClient.getQueryData<ApiKeyItem[]>(orgApiKeysQueryKey(orgId));
      queryClient.setQueryData<ApiKeyItem[]>(orgApiKeysQueryKey(orgId), (current) => {
        if (!current) return current;
        return current.filter((key) => key.id !== keyId);
      });
      return { previousKeys };
    },
    onSuccess: async () => {
      toast.success("API key deleted");
      await queryClient.invalidateQueries({ queryKey: orgApiKeysQueryKey(orgId) });
    },
    onError: (error: Error, _keyId, context) => {
      if (context?.previousKeys) {
        queryClient.setQueryData(orgApiKeysQueryKey(orgId), context.previousKeys);
      }
      toast.error(error.message || "Failed to delete API key");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (member: MemberItem) => {
      const memberIdOrEmail = member.user?.email ?? member.userId;
      const { error } = await auth.organization.removeMember({
        memberIdOrEmail,
        organizationId: orgId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Member removed");
      await queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(orgId) });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove member");
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const { error } = await auth.organization.update({
        organizationId: orgId,
        data: { name, slug },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Organization updated");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await queryClient.invalidateQueries({ queryKey: orgMembersQueryKey(orgId) });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update organization");
    },
  });

  const isPersonal = session?.user
    ? org?.slug === session.user.id ||
      (org?.metadata as { isPersonal?: boolean } | null | undefined)?.isPersonal === true
    : false;

  const leaveOrgMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.leave({ organizationId: orgId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("You have left the organization");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.navigate({ to: "/organizations" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to leave organization"),
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      const { error } = await auth.organization.delete({ organizationId: orgId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Organization deleted");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await router.navigate({ to: "/organizations" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete organization"),
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");

  if (isLoadingOrgs) {
    return (
      <PageContainer variant="wide">
        <div className="flex flex-col items-center justify-center min-h-[40vh]">
          <p className="text-sm text-muted-foreground">Loading organization...</p>
        </div>
      </PageContainer>
    );
  }

  if (!org) {
    return (
      <PageContainer variant="wide">
        <SharedEmptyState
          icon={Building2}
          title="Organization not found"
          description="This organization does not exist or you do not have access."
          action={
            <Button asChild variant="outline">
              <Link to="/organizations">back to organizations</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="wide">
      <div className="space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3 w-3" />
            <Link to="/organizations" className="hover:text-foreground transition-colors">
              Organizations
            </Link>
            <span>/</span>
            <span className="text-foreground">{org.slug}</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {org.name}
              </h1>
            </div>
          </div>
        </header>

        <Card className="p-6 space-y-4 hover:shadow-md">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>organization</Chip>
            {isActive && <Chip accent>active</Chip>}
            {isPersonal && <Chip>personal</Chip>}
          </div>
          <div className="flex flex-col gap-2">
            <InfoRow label="members" value={String(members.length)} />
            <InfoRow label="invites" value={String(pendingInvitationsCount)} />
            <InfoRow label="api keys" value={String(apiKeys.length)} />
            {org.createdAt && (
              <InfoRow label="created" value={new Date(org.createdAt).toLocaleDateString()} />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isActive && (
              <Button
                onClick={() => switchOrgMutation.mutate()}
                disabled={switchOrgMutation.isPending}
              >
                {switchOrgMutation.isPending ? "switching..." : "switch to org"}
              </Button>
            )}
            {isOwner && !isPersonal && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditName(org.name);
                  setEditSlug(org.slug);
                  setIsEditing(true);
                }}
              >
                <Edit2 className="h-3.5 w-3.5" />
                edit
              </Button>
            )}
            {!isPersonal && !isOwner && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm(`Leave "${org.name}"?`)) {
                    leaveOrgMutation.mutate();
                  }
                }}
                disabled={leaveOrgMutation.isPending}
              >
                <LogOut className="h-3.5 w-3.5" />
                {leaveOrgMutation.isPending ? "leaving..." : "leave"}
              </Button>
            )}
            {isOwner && !isPersonal && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm(`Delete "${org.name}"? This cannot be undone.`)) {
                    deleteOrgMutation.mutate();
                  }
                }}
                disabled={deleteOrgMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteOrgMutation.isPending ? "deleting..." : "delete org"}
              </Button>
            )}
          </div>
        </Card>

        {isEditing && isOwner && (
          <Card className="p-6 space-y-4 hover:shadow-md">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Edit Organization
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Organization name"
              />
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">@</span>
                <Input
                  type="text"
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value.replace(/[^a-z0-9-]/g, ""))}
                  placeholder="slug"
                  pattern="[a-z0-9-]+"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => updateOrgMutation.mutate({ name: editName, slug: editSlug })}
                disabled={updateOrgMutation.isPending || !editName || !editSlug}
              >
                {updateOrgMutation.isPending ? "saving..." : "save"}
              </Button>
              <Button onClick={() => setIsEditing(false)} variant="outline">
                cancel
              </Button>
            </div>
          </Card>
        )}

        <Tabs defaultValue="members" className="w-full min-w-0">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="members" className="shrink-0">
              <Users className="h-4 w-4 mr-1.5" />
              Members ({members.length})
            </TabsTrigger>
            <TabsTrigger value="invitations" className="shrink-0">
              <Mail className="h-4 w-4 mr-1.5" />
              Invitations ({pendingInvitationsCount})
            </TabsTrigger>
            <TabsTrigger value="apikeys" className="shrink-0">
              <Key className="h-4 w-4 mr-1.5" />
              API Keys ({apiKeys.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-6 pt-4">
            {members.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {members.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    canManage={canManageMembers && member.userId !== session?.user?.id}
                    onRemove={() => removeMemberMutation.mutate(member)}
                    isRemoving={removeMemberMutation.isPending}
                  />
                ))}
              </div>
            ) : (
              <EmptyState label="No members found" />
            )}
          </TabsContent>

          <TabsContent value="invitations" className="space-y-6 pt-4">
            {canManageMembers && !isPersonal && (
              <Card className="p-6 space-y-4 hover:shadow-md">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Invite member
                </div>
                <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                    className="w-full px-3 py-2 text-sm bg-card text-foreground border-2 border-inset border-border-strong rounded-[8px] outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button
                  onClick={() => inviteMutation.mutate()}
                  disabled={inviteMutation.isPending || !inviteEmail}
                  variant="outline"
                >
                  {inviteMutation.isPending ? "sending..." : "send invitation"}
                </Button>
              </Card>
            )}

            {(() => {
              const pendingInvitations = invitations.filter((i) => i.status === "pending");
              return pendingInvitations.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {pendingInvitations.map((invitation) => (
                    <InvitationCard
                      key={invitation.id}
                      invitation={invitation}
                      onCancel={
                        canManageMembers
                          ? () => cancelInvitationMutation.mutate(invitation.id)
                          : undefined
                      }
                      onResend={
                        canManageMembers
                          ? () => resendInvitationMutation.mutate(invitation)
                          : undefined
                      }
                      isCancelling={cancelInvitationMutation.isPending}
                      isResending={resendInvitationMutation.isPending}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState label="No pending invitations" />
              );
            })()}
          </TabsContent>

          <TabsContent value="apikeys" className="space-y-6 pt-4">
            {canManageMembers && (
              <Card className="p-6 hover:shadow-md">
                <ApiKeyForm
                  onCreate={(values: ApiKeyFormValues) => createApiKeyMutation.mutate(values)}
                  isPending={createApiKeyMutation.isPending}
                />
              </Card>
            )}

            {createdApiKey && (
              <ApiKeyReveal apiKey={createdApiKey} onDismiss={() => setCreatedApiKey(null)} />
            )}

            {apiKeys.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {apiKeys.map((key) => (
                  <Card key={key.id} className="p-5 space-y-3 hover:shadow-md">
                    <div className="space-y-1 min-w-0">
                      <div className="font-medium text-foreground break-all">
                        {key.name ?? "unnamed"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {key.prefix ?? "api_"}...{key.start ?? ""}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <div>created {new Date(key.createdAt).toLocaleString()}</div>
                      {key.expiresAt && (
                        <div>expires {new Date(key.expiresAt).toLocaleString()}</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleCopyApiKey(key.start || "", "Key prefix copied")}
                        variant="outline"
                      >
                        copy id
                      </Button>
                      {canManageMembers && (
                        <Button
                          onClick={() => deleteApiKeyMutation.mutate(key.id)}
                          disabled={deleteApiKeyMutation.isPending}
                          variant="outline"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          delete
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState label="No API keys" />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-[6px] px-2.5 py-0.5 text-[11px] font-semibold border ${accent ? "bg-brand-accent-light border-brand-accent-border" : "bg-secondary border-border"} text-foreground`}
    >
      {children}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return <Card className="p-8 text-center text-sm text-muted-foreground">{label}</Card>;
}

interface MemberCardMember {
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

function MemberCard({
  member,
  canManage,
  onRemove,
  onUpdateRole,
  isRemoving,
  isUpdatingRole,
}: {
  member: MemberCardMember;
  canManage: boolean;
  onRemove?: () => void;
  onUpdateRole?: (role: "owner" | "admin" | "member") => void;
  isRemoving?: boolean;
  isUpdatingRole?: boolean;
}) {
  const user = member.user;

  return (
    <Card className="hover:shadow-md">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {user?.image ? (
              <img
                src={user.image}
                alt=""
                className="w-9 h-9 rounded-full object-cover border-2 border-outset border-[rgb(51,51,51)] dark:border-[rgb(100,100,100)]"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-sm truncate">
                {user?.name || user?.email || member.userId}
              </div>
              {user?.email && user.name && (
                <div className="text-xs text-muted-foreground truncate">{user.email}</div>
              )}
            </div>
          </div>
          <Badge variant="outline" className="shrink-0">
            {member.role}
          </Badge>
        </div>

        {canManage && onUpdateRole && (
          <div className="flex flex-wrap gap-2">
            {member.role !== "owner" && (
              <Button
                onClick={() => onUpdateRole("owner")}
                disabled={isUpdatingRole}
                variant="outline"
                size="sm"
              >
                <Shield className="h-3 w-3 mr-1" />
                make owner
              </Button>
            )}
            {member.role !== "admin" && (
              <Button
                onClick={() => onUpdateRole("admin")}
                disabled={isUpdatingRole}
                variant="outline"
                size="sm"
              >
                <UserCog className="h-3 w-3 mr-1" />
                make admin
              </Button>
            )}
            {member.role !== "member" && (
              <Button
                onClick={() => onUpdateRole("member")}
                disabled={isUpdatingRole}
                variant="outline"
                size="sm"
              >
                make member
              </Button>
            )}
          </div>
        )}

        {canManage && onRemove && (
          <Button
            onClick={onRemove}
            disabled={isRemoving}
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            {isRemoving ? "removing..." : "remove"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface InvitationCardInvitation {
  email: string;
  role: string;
  expiresAt: string;
}

function InvitationCard({
  invitation,
  onResend,
  onCancel,
  isResending,
  isCancelling,
}: {
  invitation: InvitationCardInvitation;
  onResend?: () => void;
  onCancel?: () => void;
  isResending?: boolean;
  isCancelling?: boolean;
}) {
  return (
    <Card className="hover:shadow-md">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="font-medium text-sm break-all">{invitation.email}</div>
            </div>
            <div className="text-xs text-muted-foreground font-mono">{invitation.role}</div>
          </div>
          <div className="flex gap-1 shrink-0">
            {onResend && (
              <Button onClick={onResend} disabled={isResending} variant="outline">
                <RefreshCw className="h-3 w-3 mr-1" />
                resend
              </Button>
            )}
            {onCancel && (
              <Button
                onClick={onCancel}
                disabled={isCancelling}
                variant="outline"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                cancel
              </Button>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          expires {new Date(invitation.expiresAt).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}
