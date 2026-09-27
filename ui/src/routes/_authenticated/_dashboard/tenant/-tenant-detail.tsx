import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  getAccount,
  getActiveRuntime,
  type RouterContext,
  useApiClient,
  useAuthClient,
} from "@/app";
import { PageContainer, Skeleton } from "@/components";
import { ConnectDao } from "@/components/connect-dao";
import { EnableGaslessWrites } from "@/components/enable-gasless-writes";
import { tenantNodesQueryOptions } from "@/lib/queries/nodes";
import { tenantBindingsQueryOptions, tenantByKeyQueryOptions } from "@/lib/queries/tenants";
import { publishTenantConfigForMode, type TenantConfigPublishMode } from "@/lib/tenant-deploy";
import { useNearAccount } from "@/lib/use-near-account";
import {
  resolveOrgSlug,
  resolvePrimaryHostname,
} from "../../../_admin/_dashboard/admin/tenants/-tenant-wizard";
import { CommunityHeader } from "../dashboard/node/-community-header";
import { TenantNodeValidators } from "./-node-validators";
import { TenantDangerZone } from "./-tenant-danger-zone";
import { TenantDetails } from "./-tenant-details";
import { TenantLiveSite } from "./-tenant-live-site";
import {
  invalidatePersistedTenantQueries,
  publishPersistedTenantChange,
} from "./-tenant-mutations";
import { TenantUnavailable } from "./-tenant-unavailable";

export function TenantDetailContent({
  tenantId,
  runtimeConfig,
}: {
  tenantId: string;
  runtimeConfig?: RouterContext["runtimeConfig"];
}) {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const nearAccountId = useNearAccount();
  const gatewayId = getActiveRuntime(runtimeConfig)?.gatewayId;
  const parentAccount = getAccount(runtimeConfig);

  const assertGateway = (): string => {
    if (!gatewayId) {
      throw new Error(
        "Cannot publish the tenant config — no gateway id is resolved from the runtime. Set bos.config.json's `domain` for this build.",
      );
    }
    return gatewayId;
  };

  const { data: tenant, isLoading: tenantLoading } = useQuery({
    ...tenantByKeyQueryOptions(apiClient, tenantId, gatewayId ?? ""),
    enabled: !!tenantId && !!gatewayId,
  });

  const { data: nodes = [] } = useQuery({
    ...tenantNodesQueryOptions(apiClient, tenantId),
    enabled: !!tenantId,
  });

  const { data: bindings } = useQuery({
    ...tenantBindingsQueryOptions(apiClient, tenantId),
    enabled: !!tenantId,
  });

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: async () => {
      const { data, error } = await auth.organization.list();
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    staleTime: 60 * 1000,
  });

  const { data: members = [] } = useQuery({
    queryKey: ["org-members", tenant?.orgId],
    queryFn: async () => {
      if (!tenant?.orgId) return [];
      const { data, error } = await auth.organization.listMembers({
        query: { organizationId: tenant.orgId },
      });
      if (error) throw new Error(error.message);
      return (data?.members ?? []) as Array<{ userId: string; role: string }>;
    },
    enabled: !!tenant?.orgId,
  });

  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await auth.getSession();
      return data ?? null;
    },
    staleTime: 60 * 1000,
  });

  const isOwner = members.some((m) => m.userId === session?.user?.id && m.role === "owner");
  const isAdmin = members.some(
    (m) => m.userId === session?.user?.id && (m.role === "admin" || m.role === "owner"),
  );
  const isDaoOwned = tenant?.ownerKind === "dao";

  const publishMode: TenantConfigPublishMode = isDaoOwned ? "dao" : "platform";

  const hostname = resolvePrimaryHostname(bindings);
  const orgSlug = resolveOrgSlug(organizations, tenant?.orgId);

  async function finishPersistedChange(message: string, publicationError: Error | null) {
    const refreshError = await invalidatePersistedTenantQueries(queryClient);
    if (publicationError) {
      toast.error(`${message}, but config publication failed: ${publicationError.message}`);
    } else {
      toast.success(message);
    }
    if (refreshError) {
      toast.warning(`${message}, but the page could not refresh.`);
    }
    return { publicationError, refreshError };
  }

  const updateMutation = useMutation({
    mutationFn: async () => {
      const gid = assertGateway();
      if (!tenant) throw new Error("Tenant not loaded");
      const updated = await apiClient.updateTenant({ tenantId, name });
      return name !== updated.name
        ? publishPersistedTenantChange(updated, () =>
            publishTenantConfigForMode(apiClient, auth, {
              accountId: updated.accountId,
              gatewayId: gid,
              baseAccount: parentAccount,
              hostname,
              title: updated.name,
              status: updated.status === "active" ? "active" : undefined,
              mode: publishMode,
            }),
          )
        : { updated, publicationError: null };
    },
    onSuccess: async ({ publicationError }) => {
      await finishPersistedChange("Community renamed", publicationError);
      setEditing(false);
    },
    onError: (error: Error) => toast.error(error.message || "Failed to rename community"),
  });

  const suspendMutation = useMutation({
    mutationFn: async () => {
      const gid = assertGateway();
      const updated = await apiClient.suspendTenant({ tenantId });
      return publishPersistedTenantChange(updated, () =>
        publishTenantConfigForMode(apiClient, auth, {
          accountId: updated.accountId,
          gatewayId: gid,
          baseAccount: parentAccount,
          hostname,
          title: updated.name,
          status: "suspended",
          mode: publishMode,
        }),
      );
    },
    onSuccess: async ({ publicationError }) => {
      await finishPersistedChange("Community suspended", publicationError);
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const gid = assertGateway();
      const updated = await apiClient.reactivateTenant({ tenantId });
      return publishPersistedTenantChange(updated, () =>
        publishTenantConfigForMode(apiClient, auth, {
          accountId: updated.accountId,
          gatewayId: gid,
          baseAccount: parentAccount,
          hostname,
          title: updated.name,
          status: "active",
          mode: publishMode,
        }),
      );
    },
    onSuccess: async ({ publicationError }) => {
      await finishPersistedChange("Community reactivated", publicationError);
    },
  });

  const republishMutation = useMutation({
    mutationFn: async () => {
      const gid = assertGateway();
      return publishTenantConfigForMode(apiClient, auth, {
        accountId: tenant?.accountId ?? "",
        gatewayId: gid,
        baseAccount: parentAccount,
        hostname,
        title: tenant?.name ?? "",
        status:
          tenant?.status === "suspended" || tenant?.status === "pending_deletion"
            ? tenant?.status
            : undefined,
        mode: publishMode,
      });
    },
    onSuccess: () => toast.success("Config republished"),
    onError: (error: Error) => toast.error(error.message || "Failed to republish config"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const gid = assertGateway();
      const updated = await apiClient.deleteTenant({ tenantId });
      return publishPersistedTenantChange(updated, () =>
        publishTenantConfigForMode(apiClient, auth, {
          accountId: updated.accountId,
          gatewayId: gid,
          baseAccount: parentAccount,
          hostname,
          title: updated.name,
          status: "pending_deletion",
          mode: publishMode,
        }),
      );
    },
    onSuccess: async ({ publicationError }) => {
      if (publicationError) {
        await finishPersistedChange("Community deletion saved", publicationError);
        return;
      }
      await finishPersistedChange("Community queued for deletion", null);
      setDeleteOpen(false);
      await router.navigate({ to: "/" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete community"),
  });

  const header = (
    <CommunityHeader headerTestId="tenant.heading" nodeId={nodes[0]?.id} active="settings" />
  );
  if (tenantLoading && gatewayId) {
    return (
      <PageContainer variant="wide">
        {header}
        <Skeleton className="h-64 w-full max-w-5xl" />
      </PageContainer>
    );
  }
  if (!tenant || !gatewayId) return <TenantUnavailable gatewayId={gatewayId} />;
  return (
    <PageContainer variant="wide">
      {header}
      <div className="flex w-full max-w-5xl flex-col gap-10 sm:gap-12">
        <TenantDetails
          tenant={tenant}
          hostname={hostname}
          orgSlug={orgSlug}
          isOwner={isOwner}
          editor={{
            editing,
            name,
            isPending: updateMutation.isPending,
            onEdit: () => {
              setName(tenant.name);
              setEditing(true);
            },
            onCancel: () => setEditing(false),
            onSave: () => updateMutation.mutate(),
            onNameChange: setName,
          }}
        />
        <TenantLiveSite
          tenant={tenant}
          hostname={hostname}
          gatewayId={gatewayId}
          republish={republishMutation}
        >
          {isDaoOwned && (
            <div className="border-b border-border py-4 last:border-b-0">
              <ConnectDao purpose="community-settings" variant="plain" />
            </div>
          )}
          {!isDaoOwned && isOwner && <EnableGaslessWrites nearAccountId={nearAccountId} />}
        </TenantLiveSite>
        <TenantNodeValidators tenantId={tenant.id} canManage={isAdmin} />
        <TenantDangerZone
          tenant={tenant}
          isOwner={isOwner}
          isAdmin={isAdmin}
          suspend={suspendMutation}
          reactivate={reactivateMutation}
          open={deleteOpen}
          isPending={deleteMutation.isPending}
          onOpen={() => setDeleteOpen(true)}
          onOpenChange={setDeleteOpen}
          onConfirm={() => deleteMutation.mutate()}
        />
      </div>
    </PageContainer>
  );
}
