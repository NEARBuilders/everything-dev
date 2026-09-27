import {
  BuildingsIcon,
  CaretRightIcon,
  FingerprintIcon,
  type Icon,
  ShieldCheckIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";
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
  "create-org": BuildingsIcon,
  "choose-org": UsersThreeIcon,
  admin: ShieldCheckIcon,
};

function stepLink(step: NextStep): ReactElement {
  switch (step.id) {
    case "save-account":
      return <Link to={pluginPath("/settings/auth-methods")} />;
    case "create-org":
      return <Link to="/orgs/new" />;
    case "choose-org":
      return <Link to="/orgs" />;
    case "admin":
      return <Link to="/admin" />;
  }
}

function FeaturedStep({ step }: { step: NextStep }) {
  const StepIcon = STEP_ICONS[step.id];
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
        <Button className="w-full sm:w-auto" nativeButton={false} render={stepLink(step)}>
          {step.actionLabel}
        </Button>
      </ItemActions>
    </Item>
  );
}

function StepRow({ step }: { step: NextStep }) {
  const StepIcon = STEP_ICONS[step.id];
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

export function NextStepsList({ steps, primary }: { steps: NextStep[]; primary: boolean }) {
  const [first, ...rest] = steps;
  const featured = primary && first ? first : null;
  const rows = featured ? rest : steps;
  return (
    <ItemGroup data-testid="home-next-steps">
      {featured && <FeaturedStep step={featured} />}
      {rows.map((step) => (
        <StepRow key={step.id} step={step} />
      ))}
    </ItemGroup>
  );
}
