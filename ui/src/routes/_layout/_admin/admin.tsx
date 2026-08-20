import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { getAccount } from "@/app";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/layout/page-container";

export const Route = createFileRoute("/_layout/_admin/admin")({
  head: () => ({
    meta: [{ title: "Admin | app" }],
  }),
  beforeLoad: async ({ context }) => {
    const { apiClient, runtimeConfig } = context;
    const accountId = getAccount(runtimeConfig);
    let tenant: Awaited<ReturnType<typeof apiClient.resolveTenant>> | null = null;
    try {
      tenant = await apiClient.resolveTenant({ accountId });
    } catch {
      tenant = null;
    }
    if (!tenant) {
      throw redirect({ to: "/" });
    }
    return { tenant };
  },
  component: AdminPage,
});

function AdminPage() {
  const { tenant, session } = Route.useRouteContext();

  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const isMember = !!tenant && !!activeOrgId && activeOrgId === tenant.orgId;
  const isAdmin = session?.user?.role === "admin";
  const authorized = isMember || isAdmin;

  if (!tenant) return null;

  if (!authorized) {
    return (
      <EmptyState
        icon={Shield}
        title="Not authorized"
        description={
          <>
            You need to be a member of <span className="font-mono">{tenant.subdomain}</span>'s
            organization to access tenant admin.
          </>
        }
        action={
          <div className="flex justify-center gap-2">
            <Link
              to="/"
              className="h-10 px-4 inline-flex items-center gap-1.5 text-sm font-medium border-2 border-outset border-border-strong bg-card text-foreground shadow-sm hover:shadow-md active:border-inset active:shadow-none transition-all duration-200 ease-out rounded-[12px]"
            >
              home
            </Link>
            <Link
              to="/orgs"
              className="h-10 px-4 inline-flex items-center gap-1.5 text-sm font-medium border-2 border-outset border-border-strong bg-card text-foreground shadow-sm hover:shadow-md active:border-inset active:shadow-none transition-all duration-200 ease-out rounded-[12px]"
            >
              organizations
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <PageContainer variant="wide">
      <div className="space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Shield className="h-3 w-3" />
            Admin
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {tenant.name}
              </h1>
              <p className="text-[11px] font-mono text-muted-foreground">
                {tenant.subdomain} · {tenant.accountId}
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Subdomain" value={tenant.subdomain} mono />
          <StatCard label="Account" value={tenant.accountId} mono />
          <StatCard
            label="Organization"
            value={
              <Link
                to="/orgs/$slug"
                params={{ slug: tenant.subdomain }}
                className="text-foreground hover:underline font-mono"
              >
                {tenant.subdomain}
              </Link>
            }
          />
          <StatCard
            label="Created"
            value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
          />
        </section>

        <Outlet />
      </div>
    </PageContainer>
  );
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="border-2 border-outset border-border-strong bg-card p-4 rounded-[12px] shadow-sm space-y-1">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`text-sm text-foreground break-all ${mono ? "font-mono text-xs" : "font-semibold"}`}
      >
        {value}
      </div>
    </div>
  );
}
