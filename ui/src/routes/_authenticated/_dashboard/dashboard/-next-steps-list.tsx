import {
  BuildingsIcon,
  CaretRightIcon,
  CoinsIcon,
  CompassIcon,
  EnvelopeIcon,
  FingerprintIcon,
  GearSixIcon,
  type Icon,
  NetworkIcon,
  RocketLaunchIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { pluginPath } from "@/app";
import { Button } from "@/components";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { NextStep, NextStepId } from "./-next-steps";

const STEP_ICONS: Record<NextStepId, Icon> = {
  "save-account": FingerprintIcon,
  "add-email": EnvelopeIcon,
  "create-org": BuildingsIcon,
  "choose-org": UsersThreeIcon,
  "start-community": RocketLaunchIcon,
  "open-community": NetworkIcon,
  "community-settings": GearSixIcon,
  admin: ShieldCheckIcon,
  stake: CoinsIcon,
  explore: CompassIcon,
};

interface StepProps {
  step: NextStep;
  tenantId: string | null;
  onAddEmail?: () => void;
}

function stepLink(step: NextStep, tenantId: string | null) {
  switch (step.id) {
    case "save-account":
      return <Link to={pluginPath("/settings/auth-methods")} />;
    case "create-org":
      return <Link to="/orgs/new" />;
    case "choose-org":
      return <Link to="/orgs" />;
    case "start-community":
      return <Link to="/apply" />;
    case "open-community":
      return <Link to="/dashboard/node" />;
    case "community-settings":
      return <Link to="/tenant/$tenantId" params={{ tenantId: tenantId ?? "" }} />;
    case "admin":
      return <Link to="/admin" />;
    case "stake":
      return <Link to="/stake" />;
    case "explore":
      return <Link to="/explore" />;
  }
}

function stepAction(step: NextStep, onAddEmail: (() => void) | undefined) {
  if (step.id === "add-email" && onAddEmail) {
    return (
      <Button
        className="w-full sm:w-auto"
        onClick={onAddEmail}
        data-testid="home-step-add-email-cta"
      >
        {step.actionLabel}
      </Button>
    );
  }
  return null;
}

function FeaturedStep({ step, tenantId, onAddEmail }: StepProps) {
  const StepIcon = STEP_ICONS[step.id];
  const action = stepAction(step, onAddEmail);
  return (
    <Item variant="muted" data-testid={`home-step-${step.id}`}>
      <ItemMedia variant="icon">
        <StepIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{step.title}</ItemTitle>
        <ItemDescription>{step.description}</ItemDescription>
      </ItemContent>
      <ItemActions className="w-full sm:w-auto">
        {action ?? (
          <Button
            className="w-full sm:w-auto"
            nativeButton={false}
            render={stepLink(step, tenantId)}
          >
            {step.actionLabel}
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

function StepRow({ step, tenantId, onAddEmail }: StepProps) {
  const StepIcon = STEP_ICONS[step.id];
  const action = stepAction(step, onAddEmail);
  if (action) {
    return (
      <Item variant="outline" data-testid={`home-step-${step.id}`}>
        <ItemMedia variant="icon">
          <StepIcon />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{step.title}</ItemTitle>
          <ItemDescription>{step.description}</ItemDescription>
        </ItemContent>
        <ItemActions className="w-full sm:w-auto">{action}</ItemActions>
      </Item>
    );
  }
  return (
    <Item variant="outline" render={stepLink(step, tenantId)} data-testid={`home-step-${step.id}`}>
      <ItemMedia variant="icon">
        <StepIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{step.title}</ItemTitle>
        <ItemDescription>{step.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <CaretRightIcon className="size-4 text-muted-foreground" />
      </ItemActions>
    </Item>
  );
}

export function NextStepsList({
  steps,
  tenantId,
  primary,
  onAddEmail,
}: {
  steps: NextStep[];
  tenantId: string | null;
  primary: boolean;
  onAddEmail?: () => void;
}) {
  const [first, ...rest] = steps;
  const featured = primary && first ? first : null;
  const rows = featured ? rest : steps;
  return (
    <ItemGroup data-testid="home-next-steps">
      {featured && <FeaturedStep step={featured} tenantId={tenantId} onAddEmail={onAddEmail} />}
      {rows.map((step) => (
        <StepRow key={step.id} step={step} tenantId={tenantId} onAddEmail={onAddEmail} />
      ))}
    </ItemGroup>
  );
}
