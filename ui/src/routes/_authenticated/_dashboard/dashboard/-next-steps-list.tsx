import {
  BuildingsIcon,
  CaretRightIcon,
  CubeIcon,
  EnvelopeIcon,
  FingerprintIcon,
  ShieldCheckIcon,
  type Icon,
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
  "open-things": CubeIcon,
  admin: ShieldCheckIcon,
};

interface StepProps {
  step: NextStep;
  onAddEmail?: () => void;
}

function stepLink(step: NextStep) {
  switch (step.id) {
    case "save-account":
      return <Link to={pluginPath("/settings/auth-methods")} />;
    case "create-org":
      return <Link to="/orgs/new" />;
    case "choose-org":
      return <Link to="/orgs" />;
    case "open-things":
      return <Link to="/things" />;
    case "admin":
      return <Link to="/admin" />;
    case "add-email":
      return <Link to={pluginPath("/settings/auth-methods")} />;
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

function FeaturedStep({ step, onAddEmail }: StepProps) {
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
          <Button className="w-full sm:w-auto" nativeButton={false} render={stepLink(step)}>
            {step.actionLabel}
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

function StepRow({ step, onAddEmail }: StepProps) {
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
    <Item variant="outline" render={stepLink(step)} data-testid={`home-step-${step.id}`}>
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
  primary,
  onAddEmail,
}: {
  steps: NextStep[];
  primary: boolean;
  onAddEmail?: () => void;
}) {
  const [first, ...rest] = steps;
  const featured = primary && first ? first : null;
  const rows = featured ? rest : steps;
  return (
    <ItemGroup data-testid="home-next-steps">
      {featured && <FeaturedStep step={featured} onAddEmail={onAddEmail} />}
      {rows.map((step) => (
        <StepRow key={step.id} step={step} onAddEmail={onAddEmail} />
      ))}
    </ItemGroup>
  );
}
