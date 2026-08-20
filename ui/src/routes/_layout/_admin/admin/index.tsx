import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Settings, Users } from "lucide-react";
import { getAccount } from "@/app";
import { Button, Card } from "@/components";
import { InfoRow } from "@/components/ui/info-row";

export const Route = createFileRoute("/_layout/_admin/admin/")({
  head: () => ({
    meta: [{ title: "Admin Dashboard | app" }],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { auth, tenant } = Route.useRouteContext();
  const account = getAccount();
  const user = auth?.user ?? null;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-mono">{account}</span>
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Account" value={account} mono />
        <StatCard label="Name" value={user?.name || user?.email || "—"} />
        <StatCard label="Role" value={user?.role ?? "—"} />
        <StatCard
          label="Created"
          value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Manage</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-foreground text-background">
              <Building2 className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Organizations</h3>
            <p className="text-sm text-muted-foreground">
              Manage organizations, members, roles, and invitations.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/orgs">
                <Users className="h-3.5 w-3.5" />
                open organizations
              </Link>
            </Button>
          </Card>

          <Card className="p-6 space-y-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-foreground text-background">
              <Settings className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Settings</h3>
            <p className="text-sm text-muted-foreground">
              Update your profile, auth methods, and security preferences.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/settings">open settings</Link>
            </Button>
          </Card>
        </div>
      </section>

      {tenant && (
        <section className="space-y-3">
          <SectionHeader title="Tenant details" />
          <Card className="p-6 space-y-4">
            <div className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
              Configuration
            </div>
            <div className="flex flex-col gap-2">
              <InfoRow label="name" value={tenant.name} />
              <InfoRow label="subdomain" value={tenant.subdomain} mono />
              <InfoRow label="account" value={tenant.accountId} mono />
              <InfoRow label="org Id" value={tenant.orgId} mono />
              <InfoRow
                label="created"
                value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : "—"}
              />
            </div>
          </Card>
        </section>
      )}

      {tenant && (
        <section className="space-y-3">
          <SectionHeader title="Members & permissions" />
          <Card className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              This tenant is backed by an organization. Manage members, roles, and invitations
              there.
            </p>
            <Link
              to="/orgs/$slug"
              params={{ slug: tenant.subdomain }}
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium border-2 border-outset border-border-strong bg-card text-foreground shadow-sm hover:shadow-md active:border-inset active:shadow-none transition-all duration-200 ease-out rounded-[10px]"
            >
              <Users className="h-3.5 w-3.5" />
              open organization
            </Link>
          </Card>
        </section>
      )}
    </div>
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

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {action}
    </div>
  );
}
