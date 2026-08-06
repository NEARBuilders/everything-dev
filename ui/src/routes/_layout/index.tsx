import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Building2, Plus, Shield } from "lucide-react";
import { sessionQueryOptions, useApiClient, useAuthClient } from "@/app";
import { Button, Card } from "@/components";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/_layout/")({
  beforeLoad: async ({ context }) => {
    const { authClient } = context;
    const session = await context.queryClient.ensureQueryData(
      sessionQueryOptions(authClient, context.session),
    );
    if (!session?.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: TenantListPage,
});

function TenantListPage() {
  const apiClient = useApiClient();
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => apiClient.listTenants(),
    staleTime: 30_000,
  });

  return (
    <PageContainer variant="wide">
      <div className="space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Building2 className="h-3 w-3" />
            Tenants
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {session?.user?.name || session?.user?.email || "Your"} Tenants
              </h1>
            </div>
            <Button asChild variant="outline">
              <Link to="/tenant/new">
                <Plus className="h-4 w-4" />
                create tenant
              </Link>
            </Button>
          </div>
        </header>

        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <Card key={n} className="p-6 space-y-4">
                <div className="h-5 w-3/4 rounded-[4px] animate-pulse bg-muted" />
                <div className="h-4 w-1/2 rounded-[4px] animate-pulse bg-muted" />
                <div className="h-10 w-full rounded-[12px] animate-pulse bg-muted" />
              </Card>
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <Card className="p-10 text-center space-y-4 items-center">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-base font-semibold text-foreground">No tenants yet.</p>
            <p className="text-sm text-muted-foreground">
              Create a tenant to deploy your own app with custom UI and API.
            </p>
            <Button asChild variant="outline">
              <Link to="/tenant/new">
                <Plus className="h-4 w-4" />
                create your first tenant
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {tenants.map((tenant) => (
              <Card key={tenant.id} className="p-6 space-y-4 hover:shadow-md">
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-foreground">{tenant.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">
                    {tenant.subdomain}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <TenantMeta label="account" value={tenant.accountId} mono />
                  <TenantMeta
                    label="created"
                    value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
                  />
                </div>
                <div className="flex gap-2">
                  <Button asChild variant="outline">
                    <Link to="/admin">
                      <Shield className="h-3.5 w-3.5" />
                      manage
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function TenantMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground uppercase tracking-wide shrink-0">{label}</span>
      <span className={`text-foreground truncate ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}
