import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { pluginPath } from "@/app";
import { ConnectDao } from "@/components/connect-dao";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type OrganizationOption = { id: string; name: string };

export function ApplyOrganizationStep({
  organizations,
  displayedOrgId,
  activating,
  switching,
  onSwitch,
  onContinue,
}: {
  organizations: OrganizationOption[];
  displayedOrgId: string | null;
  activating: boolean;
  switching: boolean;
  onSwitch: (organizationId: string) => void;
  onContinue: () => void;
}) {
  if (activating) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Activating your organization…
      </p>
    );
  }
  if (organizations.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-sm text-muted-foreground">
          Communities belong to an organization. Create one first.
        </p>
        <Button
          className="w-full sm:w-auto"
          nativeButton={false}
          render={<Link to="/orgs" />}
          data-testid="apply.create-org"
        >
          Create organization
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Field className="sm:max-w-sm">
        <FieldLabel htmlFor="apply-organization">Apply as</FieldLabel>
        <Select
          items={organizations.map((organization) => ({
            label: organization.name,
            value: organization.id,
          }))}
          value={displayedOrgId}
          onValueChange={(organizationId) => {
            if (organizationId && organizationId !== displayedOrgId) onSwitch(organizationId);
          }}
          disabled={switching}
        >
          <SelectTrigger id="apply-organization" className="w-full" data-testid="apply.org-select">
            <SelectValue placeholder="Choose an organization" />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {displayedOrgId && (
          <Button type="button" onClick={onContinue} disabled={switching}>
            Continue
          </Button>
        )}
        <Button variant="ghost" nativeButton={false} render={<Link to="/orgs" />}>
          Manage organizations
        </Button>
      </div>
    </div>
  );
}

export function ApplyNearStep() {
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-sm text-muted-foreground">
        Link the NEAR account you&apos;re applying with.
      </p>
      <Button
        className="w-full sm:w-auto"
        nativeButton={false}
        render={<Link to={pluginPath("/settings/auth-methods")} />}
        data-testid="apply.link-near"
      >
        Link NEAR account
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </div>
  );
}

export function ApplyDaoStep({
  verified,
  onDaoVerified,
  onContinue,
}: {
  verified: boolean;
  onDaoVerified: (value: { daoAccountId: string }) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="w-full">
        <ConnectDao onVerified={onDaoVerified} purpose="apply" variant="plain" />
      </div>
      {verified && (
        <Button
          type="button"
          className="w-full sm:w-auto"
          onClick={onContinue}
          data-testid="apply.dao-continue"
        >
          Continue
        </Button>
      )}
    </div>
  );
}
