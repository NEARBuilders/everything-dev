import { SectionHeader } from "@/components/layout/section-header";
import { LocalDate } from "@/components/local-date";
import { InfoRow } from "@/components/ui/info-row";
import { PermissionMatrix } from "./permission-matrix";
import { useOrgWorkspace } from "./workspace-context";

export function OrgOverviewPage() {
  const { org, snapshot, myRole, mode } = useOrgWorkspace();
  const pending = snapshot.invitations.filter((invitation) => invitation.status === "pending");

  return (
    <>
      <section className="flex flex-col gap-4" data-testid="org-overview">
        <SectionHeader title="Details" />
        <div className="flex flex-col rounded-2xl border border-border px-4">
          <InfoRow label="Handle" value={<span className="font-mono">@{org.slug}</span>} />
          <InfoRow label="Members" value={snapshot.members.length} />
          <InfoRow label="Teams" value={snapshot.teams.length} />
          <InfoRow label="Pending invitations" value={pending.length} />
          <InfoRow label="Created" value={<LocalDate value={org.createdAt} />} />
          {mode === "admin" && <InfoRow label="Status" value={org.status} />}
          {myRole && <InfoRow label="Your role" value={myRole} />}
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Roles & permissions"
          description="What each organization role can do. Teams add feature areas on top."
        />
        <PermissionMatrix />
      </section>
    </>
  );
}
