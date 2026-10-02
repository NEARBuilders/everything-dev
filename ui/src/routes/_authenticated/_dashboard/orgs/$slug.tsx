import { BankIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, stripSearchParams, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  getAccount,
  getActiveRuntime,
  type SessionData,
  sessionQueryOptions,
  useApiClient,
  useAuthClient,
} from "@/app";
import {
  Button,
  EmptyState,
  PageContainer,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useSwitchOrganization } from "@/components/layout/use-switch-organization";
import { useTeamWorkspace } from "@/components/layout/use-team-workspace";
import { pageTitle } from "@/lib/page-title";
import { organizationsQueryOptions } from "@/lib/queries/organizations";
import {
  ApiKeysTab,
  type CreatedOrganizationApiKey,
  type OrganizationApiKey,
} from "./-api-keys-tab";
import { HomepageTab } from "./-homepage-tab";
import { InvitationsTab } from "./-invitations-tab";
import { MembersTab } from "./-members-tab";
import { NodeConfigTab } from "./-node-config";
import { OnboardingTab } from "./-onboarding-tab";
import { useOrganizationApiKeyActions } from "./-organization-api-keys";
import { OrganizationEditForm } from "./-organization-edit-form";
import { useOrganizationInvitationActions } from "./-organization-invitations";
import { useOrganizationMemberActions } from "./-organization-members";
import { OrganizationOverview } from "./-organization-overview";
import {
  orgApiKeysQueryKey,
  orgInvitationsQueryKey,
  orgMembersQueryKey,
} from "./-organization-query-keys";
import { useOrganizationSettings } from "./-organization-settings";
import { useOrganizationTeams } from "./-organization-teams";
import { TeamsTab } from "./-teams-tab";

type AuthClientType = import("@/app").AuthClient;
type ApiClientType = import("@/app").ApiClient;
type MembersResponse = Awaited<ReturnType<AuthClientType["organization"]["listMembers"]>>;
type MemberItem = NonNullable<MembersResponse["data"]>["members"][number];
type InvitationItem = Awaited<ReturnType<ApiClientType["auth"]["listInvitations"]>>[number];

const ORGANIZATION_TABS = [
  "members",
  "teams",
  "invitations",
  "onboard",
  "apikeys",
  "node-config",
  "homepage",
] as const;

type OrganizationTab = (typeof ORGANIZATION_TABS)[number];

const organizationSearchSchema = z.object({
  tab: z.enum(ORGANIZATION_TABS).default("members").catch("members"),
});

function isOrganizationTab(value: unknown): value is OrganizationTab {
  return ORGANIZATION_TABS.some((tab) => tab === value);
}

async function handleCopyApiKey(value: string, message = "API key copied") {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.error("Failed to copy API key");
  }
}

export const Route = createFileRoute("/_authenticated/_dashboard/orgs/$slug")({
  validateSearch: organizationSearchSchema,
  search: { middlewares: [stripSearchParams({ tab: "members" })] },
  head: ({ match }) => ({
    meta: [
      { title: pageTitle("Organization", match.context.runtimeConfig) },
      { name: "description", content: "Members, teams and settings for an organization." },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueryOptions(context.authClient));
    await context.queryClient.ensureQueryData(organizationsQueryOptions(context.apiClient));
  },
  component: OrganizationDetail,
});

function OrganizationDetail() {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { slug: orgSlug } = Route.useParams();
  const { tab: requestedTab } = Route.useSearch();
  const auth = useAuthClient();
  const apiClient = useApiClient();
  const { runtimeConfig } = Route.useRouteContext();
  const gatewayId = getActiveRuntime(runtimeConfig)?.gatewayId ?? "";
  const baseAccount = getAccount(runtimeConfig);
  const { data: session } = useQuery<SessionData | null>(sessionQueryOptions(auth));
  const { data: organizations = [], isLoading: isLoadingOrgs } = useQuery(
    organizationsQueryOptions(apiClient),
  );
  const org = organizations.find((organization) => organization.slug === orgSlug);
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
      enabled: !!orgId && org?.status === "active",
    }).data ?? [];
  const invitations =
    useQuery({
      queryKey: orgInvitationsQueryKey(orgId),
      queryFn: async (): Promise<InvitationItem[]> => {
        return apiClient.auth.listInvitations({ organizationId: orgId });
      },
      enabled: !!orgId && org?.status === "active",
    }).data ?? [];
  const apiKeys =
    useQuery({
      queryKey: orgApiKeysQueryKey(orgId),
      queryFn: async (): Promise<OrganizationApiKey[]> => {
        const { data, error } = await auth.apiKey.list({
          query: { configId: "org-keys", organizationId: orgId },
        });
        if (error) throw new Error(error.message);
        return (data?.apiKeys ?? []) as OrganizationApiKey[];
      },
      enabled: !!orgId && org?.status === "active",
    }).data ?? [];
  const myMembership = members.find((member) => member.userId === session?.user?.id);
  const canManageMembers = myMembership?.role === "owner" || myMembership?.role === "admin";
  const isOwner = myMembership?.role === "owner";
  const workspace = useTeamWorkspace(isActive).data;
  const canOrganize =
    canManageMembers ||
    (isActive && (workspace?.teams ?? []).some((team) => team.areas.includes("events")));
  const pendingInvitationsCount = invitations.filter(
    (invitation) => invitation.status === "pending",
  ).length;
  const [createdApiKey, setCreatedApiKey] = useState<CreatedOrganizationApiKey | null>(null);
  const switchOrg = useSwitchOrganization();

  const [pendingTeamDeleteId, setPendingTeamDeleteId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const isPersonal = session?.user
    ? org?.slug === session.user.id ||
      (org?.metadata as { isPersonal?: boolean } | null | undefined)?.isPersonal === true
    : false;
  const { cancelInvitationMutation, inviteMutation, resendInvitationMutation } =
    useOrganizationInvitationActions(apiClient, orgId);
  const { createApiKeyMutation, deleteApiKeyMutation } = useOrganizationApiKeyActions(
    auth,
    orgId,
    (apiKey) => setCreatedApiKey(apiKey),
  );
  const { removeMemberMutation } = useOrganizationMemberActions(auth, orgId);
  const canExportEmails = canManageMembers || session?.user?.role === "admin";
  const exportEmailsMutation = useMutation({
    mutationFn: async () => {
      const result = await apiClient.auth.exportMembers({ organizationId: orgId });
      return result.csv;
    },
    onSuccess: async (csv) => {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${org?.slug ?? "organization"}-members.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Member emails exported");
    },
    onError: (error: Error) => toast.error(error.message || "Failed to export emails"),
  });
  const activeTab = requestedTab === "onboard" && !canOrganize ? "members" : requestedTab;
  const setActiveTab = (value: unknown) => {
    if (!isOrganizationTab(value) || value === activeTab) return;
    void navigate({ search: (prev) => ({ ...prev, tab: value }), replace: true });
  };
  const teamsState = useOrganizationTeams(orgId, activeTab === "teams" && org?.status === "active");
  const { deleteOrgMutation, leaveOrgMutation, updateOrgMutation } = useOrganizationSettings(
    auth,
    orgId,
    router,
    () => setIsEditing(false),
  );

  if (isLoadingOrgs) {
    return (
      <PageContainer variant="wide">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (!org) {
    return (
      <PageContainer variant="wide">
        <EmptyState
          icon={BankIcon}
          title="Organization not found"
          description="It doesn't exist or you're not a member."
          action={
            <Button variant="outline" nativeButton={false} render={<Link to="/orgs" />}>
              Back to Organizations
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (org?.status !== "active") {
    return (
      <PageContainer variant="narrow">
        <PageHeader
          title={org.name}
          subtitle={`@${org.slug}`}
          headerTestId="orgs.request.heading"
        />
        <div className="flex flex-col gap-4" data-testid="orgs-request-status">
          <h2 className="text-lg font-medium">
            {org?.status === "pending" ? "Pending approval" : "Request rejected"}
          </h2>
          <p className="text-sm text-muted-foreground" data-testid="orgs-request-reason">
            {org?.status === "pending"
              ? "A platform admin will review your request. Your organization can be used once approved."
              : org.rejectionReason}
          </p>
          <Button variant="outline" nativeButton={false} render={<Link to="/orgs" />}>
            Back to organizations
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="wide">
      <OrganizationOverview
        canDelete={isOwner}
        isDeleting={deleteOrgMutation.isPending}
        isActive={isActive}
        isPersonal={isPersonal}
        isLeaving={leaveOrgMutation.isPending}
        isSwitching={switchOrg.isPending}
        memberCount={members.length}
        myRole={myMembership?.role}
        onDelete={() => deleteOrgMutation.mutate()}
        onEdit={() => {
          setEditName(org.name);
          setEditSlug(org.slug);
          setIsEditing(true);
        }}
        onLeave={() => leaveOrgMutation.mutate()}
        onSwitch={() => switchOrg.mutate(orgId)}
        org={org}
      />
      {isOwner && (
        <OrganizationEditForm
          open={isEditing}
          editName={editName}
          editSlug={editSlug}
          isPending={updateOrgMutation.isPending}
          onCancel={() => setIsEditing(false)}
          onNameChange={setEditName}
          onSave={() => updateOrgMutation.mutate({ name: editName, slug: editSlug })}
          onSlugChange={setEditSlug}
        />
      )}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList variant="line">
            <TabsTrigger value="members" data-testid="orgs-tab-members">
              Members <TabCount value={members.length} />
            </TabsTrigger>
            <TabsTrigger value="teams" data-testid="orgs-tab-teams">
              Teams <TabCount value={teamsState.teams.length} />
            </TabsTrigger>
            <TabsTrigger value="invitations" data-testid="orgs-tab-invitations">
              Invitations <TabCount value={pendingInvitationsCount} />
            </TabsTrigger>
            {canOrganize && (
              <TabsTrigger value="onboard" data-testid="orgs-tab-onboard">
                Onboarding
              </TabsTrigger>
            )}
            <TabsTrigger value="apikeys" data-testid="orgs-tab-apikeys">
              API keys <TabCount value={apiKeys.length} />
            </TabsTrigger>
            <TabsTrigger value="node-config" data-testid="orgs-tab-node-config">
              Community
            </TabsTrigger>
            <TabsTrigger value="homepage" data-testid="orgs-tab-homepage">
              Homepage
            </TabsTrigger>
          </TabsList>
        </div>
        <MembersTab
          canManageMembers={canManageMembers}
          canExportEmails={canExportEmails}
          isExportingEmails={exportEmailsMutation.isPending}
          isRemoving={removeMemberMutation.isPending}
          members={members}
          onExportEmails={() => exportEmailsMutation.mutate()}
          onInvite={isPersonal ? undefined : () => setActiveTab("invitations")}
          onRemove={(member) => removeMemberMutation.mutate(member)}
          sessionUserId={session?.user?.id}
        />
        <TeamsTab
          canManage={canManageMembers}
          isMutating={teamsState.isMutating}
          onAddMember={(teamId, userId) => teamsState.addTeamMember.mutate({ teamId, userId })}
          onAreasChange={(teamId, areas) => teamsState.updateTeam.mutate({ teamId, areas })}
          onCreate={(name) => teamsState.createTeam.mutate(name)}
          onDelete={(teamId) => setPendingTeamDeleteId(teamId)}
          onRemoveMember={(teamId, userId) =>
            teamsState.removeTeamMember.mutate({ teamId, userId })
          }
          onRetryMembers={teamsState.retryTeamMembers}
          onRename={(teamId, name) => teamsState.updateTeam.mutate({ teamId, name })}
          orgMembers={members}
          teams={teamsState.teams}
        />
        <ConfirmDialog
          open={pendingTeamDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingTeamDeleteId(null);
          }}
          title={`Delete ${teamsState.teams.find((team) => team.id === pendingTeamDeleteId)?.name ?? "team"}?`}
          description="Members lose the areas this team grants. This can't be undone."
          confirmLabel="Delete team"
          variant="destructive"
          isPending={teamsState.deleteTeam.isPending}
          onConfirm={() => {
            if (!pendingTeamDeleteId) return;
            teamsState.deleteTeam.mutate(pendingTeamDeleteId, {
              onSettled: () => setPendingTeamDeleteId(null),
            });
          }}
        />
        <InvitationsTab
          canManageMembers={canManageMembers}
          invitePending={inviteMutation.isPending}
          invitations={invitations}
          isPersonal={isPersonal}
          isCancelling={cancelInvitationMutation.isPending}
          isResending={resendInvitationMutation.isPending}
          onCancel={(invitationId) => cancelInvitationMutation.mutate(invitationId)}
          onInvite={(values) => inviteMutation.mutateAsync(values)}
          onResend={(invitation) => resendInvitationMutation.mutate(invitation)}
          teams={teamsState.teams}
        />
        {canOrganize && <OnboardingTab apiClient={apiClient} canManage orgId={orgId} />}
        <ApiKeysTab
          apiKeys={apiKeys}
          canManageMembers={canManageMembers}
          createdApiKey={createdApiKey}
          isCreating={createApiKeyMutation.isPending}
          isDeleting={deleteApiKeyMutation.isPending}
          onCopy={handleCopyApiKey}
          onCreate={(values) => createApiKeyMutation.mutate(values)}
          onDelete={(keyId) => deleteApiKeyMutation.mutate(keyId)}
          onDismiss={() => setCreatedApiKey(null)}
        />
        <TabsContent value="node-config" className="flex flex-col gap-6 pt-6">
          <NodeConfigTab
            orgId={orgId}
            gatewayId={gatewayId}
            baseAccount={baseAccount}
            canManage={canManageMembers}
            isPlatformAdmin={session?.user?.role === "admin"}
          />
        </TabsContent>
        <TabsContent value="homepage" className="flex flex-col gap-6 pt-6">
          <HomepageTab
            orgId={orgId}
            gatewayId={gatewayId}
            baseAccount={baseAccount}
            canManage={canManageMembers}
            isActive={isActive}
          />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function TabCount({ value }: { value: number }) {
  if (value === 0) return null;
  return <span className="text-muted-foreground tabular-nums">{value}</span>;
}
