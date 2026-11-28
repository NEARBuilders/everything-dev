import { BankIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { sessionQueryOptions, useAuthClient } from "everything-dev/ui/auth";
import { useMemo } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orgWorkspaceQueryKey } from "@/lib/org-query-keys";
import { useAuthApi } from "@/lib/use-auth-api";
import {
  createAdminAdapter,
  createMemberAdapter,
  OrganizationNotFoundError,
  type WorkspaceMode,
} from "./adapter";
import { OrgHeader } from "./org-header";
import { OrgLink, type OrgTarget } from "./org-link";
import { OrgWorkspaceProvider, useOrgWorkspace } from "./workspace-context";

export function orgWorkspaceQueryOptions(
  mode: WorkspaceMode,
  reference: string,
  load: () => ReturnType<ReturnType<typeof createMemberAdapter>["loadSnapshot"]>,
) {
  return {
    queryKey: orgWorkspaceQueryKey(mode, reference),
    queryFn: load,
    staleTime: 30 * 1000,
    retry: false,
  };
}

export function OrgWorkspaceLayout({
  mode,
  reference,
}: {
  mode: WorkspaceMode;
  reference: string;
}) {
  const api = useAuthApi();
  const authClient = useAuthClient();
  const adapter = useMemo(
    () => (mode === "admin" ? createAdminAdapter(api) : createMemberAdapter(api)),
    [mode, api],
  );
  const { data: session } = useQuery(sessionQueryOptions(authClient));
  const viewerUserId = session?.user?.id;
  const snapshotQuery = useQuery(
    orgWorkspaceQueryOptions(mode, reference, () => adapter.loadSnapshot(reference, viewerUserId)),
  );

  if (snapshotQuery.isPending) {
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

  if (snapshotQuery.isError) {
    const notFound = snapshotQuery.error instanceof OrganizationNotFoundError;
    return (
      <PageContainer variant="wide">
        <EmptyState
          icon={BankIcon}
          title={notFound ? "Organization not found" : "Couldn't load this organization"}
          description={
            notFound ? "It doesn't exist or you're not a member." : snapshotQuery.error.message
          }
          action={
            <div className="flex gap-2">
              {!notFound && (
                <Button variant="outline" onClick={() => void snapshotQuery.refetch()}>
                  Try again
                </Button>
              )}
              <BackToOrganizations mode={mode} />
            </div>
          }
        />
      </PageContainer>
    );
  }

  return (
    <OrgWorkspaceProvider
      adapter={adapter}
      reference={reference}
      snapshot={snapshotQuery.data}
      viewerUserId={viewerUserId}
      activeOrganizationId={session?.session?.activeOrganizationId ?? null}
    >
      <PageContainer variant="wide">
        <OrgHeader />
        <WorkspaceTabs />
        <div className="flex min-w-0 flex-col gap-8">
          <Outlet />
        </div>
      </PageContainer>
    </OrgWorkspaceProvider>
  );
}

function BackToOrganizations({ mode }: { mode: WorkspaceMode }) {
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={mode === "admin" ? <Link to="/admin/orgs" /> : <Link to="/orgs" />}
    >
      Back to Organizations
    </Button>
  );
}

function WorkspaceTabs() {
  const { snapshot, adapter, canManage, mode, reference } = useOrgWorkspace();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const base = mode === "admin" ? `/admin/orgs/${reference}` : `/orgs/${reference}`;
  const pendingInvitations = snapshot.invitations.filter(
    (invitation) => invitation.status === "pending",
  ).length;

  const tabs: Array<{
    id: string;
    target: OrgTarget;
    label: string;
    count?: number;
    path: string;
  }> = [
    { id: "overview", target: { to: "overview" }, label: "Overview", path: base },
    {
      id: "members",
      target: { to: "members" },
      label: "Members",
      count: snapshot.members.length,
      path: `${base}/members`,
    },
    {
      id: "teams",
      target: { to: "teams" },
      label: "Teams",
      count: snapshot.teams.length,
      path: `${base}/teams`,
    },
    ...(canManage
      ? [
          {
            id: "invitations",
            target: { to: "invitations" } as OrgTarget,
            label: "Invitations",
            count: pendingInvitations,
            path: `${base}/invitations`,
          },
        ]
      : []),
    ...(adapter.capabilities.apiKeys && canManage
      ? [
          {
            id: "api-keys",
            target: { to: "api-keys" } as OrgTarget,
            label: "API keys",
            path: `${base}/api-keys`,
          },
        ]
      : []),
  ];

  const active =
    [...tabs]
      .sort((a, b) => b.path.length - a.path.length)
      .find((tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`))?.id ??
    "overview";

  return (
    <nav
      aria-label="Organization"
      className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      data-testid="org-tabs"
    >
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          variant={tab.id === active ? "secondary" : "ghost"}
          nativeButton={false}
          render={<OrgLink section={tab.target} />}
          aria-current={tab.id === active ? "page" : undefined}
          data-testid={`orgs-tab-${tab.id}`}
          className="shrink-0"
        >
          {tab.label}
          {tab.count ? (
            <span className="text-muted-foreground tabular-nums">{tab.count}</span>
          ) : null}
        </Button>
      ))}
    </nav>
  );
}
