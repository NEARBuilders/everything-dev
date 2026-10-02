import { InfoRow } from "@/components";
import { nodeProposalPayloadSchema } from "@/routes/_authenticated/_dashboard/-node-application";
import { humanize } from "../-admin-ui";

export function NodeProposalDetails({ payload }: { payload: unknown }) {
  const parsed = nodeProposalPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This application's payload is invalid and can't be applied safely.
      </p>
    );
  }

  const proposal = parsed.data;
  return (
    <div className="flex flex-col gap-6">
      <blockquote className="border-l-2 border-border pl-4 text-base whitespace-pre-wrap text-foreground">
        {proposal.motivation}
      </blockquote>
      <div className="flex flex-col">
        <InfoRow label="Kind" value={humanize(proposal.kind)} />
        <InfoRow label="Slug" value={proposal.slug} mono />
        <InfoRow
          label="Parent"
          value={proposal.parentId ?? "None (country)"}
          mono={!!proposal.parentId}
        />
        <InfoRow label="Owning DAO" value={proposal.accountId} mono />
        <InfoRow label="Submitted from" value={proposal.submitterAccountId} mono />
        <InfoRow label="Organization" value={proposal.orgId} mono />
      </div>
    </div>
  );
}
