import { WarningIcon } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { PageHeader } from "@/components";
import { ConnectDao } from "@/components/connect-dao";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { BackLink } from "../-admin-ui";
import { TenantDetailsFields, TenantReview } from "./-tenant-creation-form";
import { TenantOrganizationGate } from "./-tenant-organization-gate";
import { TenantStep } from "./-tenant-step";
import { type NearNetworkId, resolveTenantWizardSteps } from "./-tenant-wizard";

export function TenantCreationStage({
  activeNetwork,
  organization,
  dao,
  details,
  review,
}: {
  activeNetwork: NearNetworkId;
  organization: {
    hasOrg: boolean;
    gate: ComponentProps<typeof TenantOrganizationGate>;
  };
  dao: { ready: boolean; accountId: string | null; onChange: () => void };
  details: ComponentProps<typeof TenantDetailsFields> & {
    confirmed: boolean;
    summary: string;
    onEdit: () => void;
  };
  review: ComponentProps<typeof TenantReview>;
}) {
  const steps = resolveTenantWizardSteps({
    organization: organization.hasOrg,
    dao: dao.ready,
    details: details.confirmed,
  });
  const { confirmed: _confirmed, summary: detailsSummary, onEdit, ...detailsFields } = details;

  return (
    <>
      <PageHeader
        label={<BackLink to="/admin/tenants">Sites</BackLink>}
        title="New site"
        description="A site, its first community and a primary domain, owned by a DAO."
        headerTestId="admin-tenant-new.heading"
      />

      {activeNetwork !== "mainnet" && (
        <Item variant="outline" data-testid="admin-tenant-network-notice">
          <ItemMedia variant="icon">
            <WarningIcon className="text-warning" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Switch to mainnet</ItemTitle>
            <ItemDescription>DAO sites can only be created on mainnet.</ItemDescription>
          </ItemContent>
        </Item>
      )}

      <ol className="flex flex-col" data-testid="admin-tenant-steps">
        <TenantStep
          id="organization"
          number={1}
          title="Organization"
          status={steps.status("organization")}
          summary="Using your active organization"
        >
          <TenantOrganizationGate {...organization.gate} />
        </TenantStep>
        <TenantStep
          id="dao"
          number={2}
          title="Owning DAO"
          status={steps.status("dao")}
          summary={dao.accountId}
          onChange={dao.onChange}
        >
          <div className="max-w-xl">
            <ConnectDao purpose="tenant-create" variant="plain" />
          </div>
        </TenantStep>
        <TenantStep
          id="details"
          number={3}
          title="Community"
          status={steps.status("details")}
          summary={detailsSummary}
          onChange={onEdit}
        >
          <TenantDetailsFields {...detailsFields} />
        </TenantStep>
        <TenantStep
          id="review"
          number={4}
          title="Review and create"
          status={steps.status("review")}
          last
        >
          <TenantReview {...review} />
        </TenantStep>
      </ol>
    </>
  );
}
