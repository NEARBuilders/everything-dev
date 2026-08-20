import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Building2, ExternalLink, Pencil, Trash2, Users } from "lucide-react";
import type { TransactionBuilder } from "near-kit";
import { useState } from "react";
import { toast } from "sonner";
import { getAccount, getActiveRuntime, useApiClient, useAuthClient } from "@/app";
import { Badge, Button, Card, CardContent, ConfirmDialog, InfoRow, Input } from "@/components";
import { PageContainer } from "@/components/layout/page-container";

const CONFIG_GAS = "300000000000000";

async function publishTenantConfig(
  apiClient: ReturnType<typeof useApiClient>,
  auth: ReturnType<typeof useAuthClient>,
  input: {
    accountId: string;
    gatewayId: string;
    subdomain: string;
    name: string;
    status?: "active" | "suspended" | "pending_deletion";
  },
) {
  const parentAccount = getAccount();
  const tenantConfig = {
    extends: `bos://${parentAccount}/${input.gatewayId}`,
    account: input.accountId,
    domain: `${input.subdomain}.${input.gatewayId}`,
    title: input.name,
    description: input.name,
    ...(input.status ? { status: input.status } : {}),
  };

  const prepared = await apiClient.apps.prepareRegistryConfigWrite({
    accountId: input.accountId,
    gatewayId: input.gatewayId,
    config: tenantConfig,
  });

  const signed = await auth.near.buildSignedDelegateAction(
    prepared.data.contractId,
    (builder: TransactionBuilder) =>
      builder.functionCall(prepared.data.contractId, prepared.data.methodName, prepared.data.args, {
        gas: CONFIG_GAS,
        attachedDeposit: 0n,
      }),
  );

  const relayed = await auth.near.relayTransaction({ payload: signed });
  if (relayed.error) throw new Error(relayed.error.message);
  return relayed;
}

export const Route = createFileRoute("/_layout/_authenticated/tenant/$tenantId")({
  head: () => ({
    meta: [{ title: "Tenant | app" }],
  }),
  component: TenantDetail,
});

function TenantDetail() {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { tenantId } = Route.useParams();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const gatewayId = getActiveRuntime()?.gatewayId ?? "everything.dev";

  const { data: tenant } = useQuery({
    queryKey: ["tenant", tenantId],
    queryFn: async () => {
      const tenants = await apiClient.listTenants();
      const found = tenants.find((t) => t.id === tenantId);
      if (!found) throw new Error("Tenant not found");
      return found;
    },
    enabled: !!tenantId,
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const updated = await apiClient.updateTenant({
        tenantId,
        name,
        subdomain,
      });
      if (name !== updated.name || subdomain !== updated.subdomain) {
        await publishTenantConfig(apiClient, auth, {
          accountId: updated.accountId,
          gatewayId,
          subdomain: updated.subdomain,
          name: updated.name,
          status: updated.status === "active" ? "active" : undefined,
        });
      }
      return updated;
    },
    onSuccess: () => {
      toast.success("Tenant updated");
      setEditing(false);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update tenant"),
  });

  const suspendMutation = useMutation({
    mutationFn: async () => {
      const updated = await apiClient.suspendTenant({ tenantId });
      await publishTenantConfig(apiClient, auth, {
        accountId: updated.accountId,
        gatewayId,
        subdomain: updated.subdomain,
        name: updated.name,
        status: "suspended",
      });
      return updated;
    },
    onSuccess: () => {
      toast.success("Tenant suspended");
      invalidate();
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const updated = await apiClient.reactivateTenant({ tenantId });
      await publishTenantConfig(apiClient, auth, {
        accountId: updated.accountId,
        gatewayId,
        subdomain: updated.subdomain,
        name: updated.name,
        status: "active",
      });
      return updated;
    },
    onSuccess: () => {
      toast.success("Tenant reactivated");
      invalidate();
    },
  });

  const republishMutation = useMutation({
    mutationFn: async () => {
      return publishTenantConfig(apiClient, auth, {
        accountId: tenant?.accountId ?? "",
        gatewayId,
        subdomain: tenant?.subdomain ?? "",
        name: tenant?.name ?? "",
        status:
          tenant?.status === "suspended" || tenant?.status === "pending_deletion"
            ? tenant?.status
            : undefined,
      });
    },
    onSuccess: () => toast.success("Config republished"),
    onError: (error: Error) => toast.error(error.message || "Failed to republish config"),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const updated = await apiClient.deleteTenant({ tenantId });
      await publishTenantConfig(apiClient, auth, {
        accountId: updated.accountId,
        gatewayId,
        subdomain: updated.subdomain,
        name: updated.name,
        status: "pending_deletion",
      });
      return updated;
    },
    onSuccess: () => {
      toast.success("Tenant queued for deletion");
      setDeleteOpen(false);
      router.navigate({ to: "/" });
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete tenant"),
  });

  if (!tenant) {
    return (
      <PageContainer variant="narrow">
        <div className="text-muted-foreground text-sm py-12">Loading tenant…</div>
      </PageContainer>
    );
  }

  const statusVariant =
    tenant.status === "active"
      ? "default"
      : tenant.status === "suspended"
        ? "destructive"
        : "secondary";

  return (
    <PageContainer variant="wide">
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Building2 className="h-3 w-3" />
            Tenant
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {tenant.name}
              </h1>
              <p className="text-[11px] font-mono text-muted-foreground">
                {tenant.subdomain}.{gatewayId} · {tenant.accountId}
              </p>
            </div>

            <div className="flex gap-2">
              <Badge variant={statusVariant as "default" | "destructive" | "secondary"}>
                {tenant.status}
              </Badge>
              {isAdmin && tenant.status === "active" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => suspendMutation.mutate()}
                  disabled={suspendMutation.isPending}
                >
                  suspend
                </Button>
              )}
              {isAdmin && tenant.status === "suspended" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reactivateMutation.mutate()}
                  disabled={reactivateMutation.isPending}
                >
                  reactivate
                </Button>
              )}
              {isOwner && tenant.status === "active" && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  delete
                </Button>
              )}
            </div>
          </div>
        </header>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Details</h2>
            {isOwner && !editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setName(tenant.name);
                  setSubdomain(tenant.subdomain);
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                edit
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="p-6 space-y-4">
              {editing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateMutation.mutate();
                  }}
                  className="space-y-4"
                >
                  <InfoRow
                    label="name"
                    value={
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="max-w-xs"
                      />
                    }
                  />
                  <InfoRow
                    label="subdomain"
                    value={
                      <Input
                        value={subdomain}
                        onChange={(e) => setSubdomain(e.target.value.replace(/[^a-z0-9-]/g, ""))}
                        className="max-w-xs"
                      />
                    }
                  />
                  <div className="flex gap-2 pt-1">
                    <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                      save
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(false)}
                    >
                      cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <InfoRow label="name" value={tenant.name} />
                  <InfoRow label="subdomain" value={`${tenant.subdomain}.${gatewayId}`} mono />
                  <InfoRow label="account" value={tenant.accountId} mono />
                  <InfoRow label="org id" value={tenant.orgId} mono />
                  <InfoRow label="status" value={tenant.status} />
                  <InfoRow
                    label="created"
                    value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
                  />
                  <InfoRow
                    label="updated"
                    value={tenant.updatedAt ? new Date(tenant.updatedAt).toLocaleString() : "—"}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Live site</h2>
          </div>
          <Card className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Your tenant is served at the subdomain below. The site resolves through the parent
              gateway's host.
            </p>
            <a
              href={`https://${tenant.subdomain}.${gatewayId}`}
              target="_blank"
              rel="noreferrer"
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium border-2 border-outset border-border-strong bg-card text-foreground shadow-sm hover:shadow-md active:border-inset active:shadow-none transition-all duration-200 ease-out rounded-[10px] w-fit"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              open {tenant.subdomain}.{gatewayId}
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => republishMutation.mutate()}
              disabled={republishMutation.isPending}
            >
              republish config
            </Button>
          </Card>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Members & permissions</h2>
          </div>
          <Card className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              This tenant is backed by an organization. Manage members, roles, and invitations
              there.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/orgs/$slug" params={{ slug: tenant.subdomain }}>
                <Users className="h-3.5 w-3.5" />
                open organization
              </Link>
            </Button>
          </Card>
        </section>

        {isOwner && (
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Danger zone</h2>
            </div>
            <Card className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Deleting a tenant suspends it immediately and permanently removes it after a 30-day
                grace period.
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                delete tenant
              </Button>
            </Card>
          </section>
        )}

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete this tenant?"
          description="The tenant will be suspended immediately and permanently deleted after 30 days. This cannot be undone."
          confirmLabel="delete tenant"
          variant="destructive"
          onConfirm={() => deleteMutation.mutate()}
          isPending={deleteMutation.isPending}
        />
      </div>
    </PageContainer>
  );
}
