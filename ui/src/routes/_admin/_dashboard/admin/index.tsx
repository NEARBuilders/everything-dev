import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, SectionHeader } from "@/components";
import { VersionCard } from "@/components/version-card";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_admin/_dashboard/admin/")({
  loader: async ({ context }) => ({ runtimeConfig: context.runtimeConfig }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle("Admin", match.context.runtimeConfig) }],
  }),
  component: AdminIndex,
});

function AdminIndex() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        headerTestId="admin.heading"
        title="Admin"
        description="Platform administration for this runtime."
      />
      <section className="flex flex-col gap-6">
        <SectionHeader title="Version" sectionTestId="admin.heading.version" />
        <VersionCard />
      </section>
      <section className="flex flex-col gap-6">
        <SectionHeader title="System" sectionTestId="admin.heading.system" />
        <div className="flex flex-col">
          <SystemLink />
        </div>
      </section>
    </div>
  );
}

function SystemLink() {
  return (
    <Link
      to="/admin/system"
      data-testid="admin-system-link"
      className="text-sm text-foreground underline-offset-4 hover:underline"
    >
      Runtime, version, and deployment details
    </Link>
  );
}
