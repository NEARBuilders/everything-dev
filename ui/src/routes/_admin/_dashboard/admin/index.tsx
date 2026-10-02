import { GearIcon } from "@phosphor-icons/react";
import { Link, createFileRoute } from "@tanstack/router";
import { getAccount } from "@/app";
import { Badge, PageHeader, SectionHeader } from "@/components";
import { VersionCard } from "@/components/version-card";
import { pageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/_admin/_dashboard/admin/")({
  head: () => ({
    meta: [{ title: pageTitle("Admin", getAccount()) }],
  }),
  component: AdminIndex,
});

function AdminIndex() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        headerTestId="admin.heading"
        icon={<GearIcon className="size-6 text-muted-foreground" />}
        title="Admin"
        description="Platform administration for this runtime."
      />
      <SectionHeader sectionTestId="admin-version">Version</SectionHeader>
      <VersionCard />
      <SectionHeader sectionTestId="admin-system">System</SectionHeader>
      <div className="flex flex-col gap-2">
        <Link
          to="/admin/system"
          className="text-sm text-foreground underline-offset-4 hover:underline"
        >
          <Badge variant="outline">System</Badge>
        </Link>
        <span className="text-sm text-muted-foreground">
          Runtime, version, and deployment details.
        </span>
      </div>
    </div>
  );
}
