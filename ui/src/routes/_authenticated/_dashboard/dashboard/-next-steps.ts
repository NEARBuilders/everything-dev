export type NextStepId =
  | "save-account"
  | "create-org"
  | "choose-org"
  | "start-community"
  | "open-community"
  | "community-settings"
  | "admin"
  | "stake"
  | "explore";

export interface NextStep {
  id: NextStepId;
  title: string;
  description: string;
  actionLabel: string;
}

export interface NextStepsState {
  isAnonymous: boolean;
  hasPasskey: boolean;
  hasNear: boolean;
  organizationCount: number;
  activeOrganizationName: string | null;
  community: { name: string; tenantId: string } | null;
  canManageCommunity: boolean;
  isAdmin: boolean;
}

export function getNextSteps(state: NextStepsState): NextStep[] {
  const steps: NextStep[] = [];

  if (state.isAnonymous && !state.hasPasskey && !state.hasNear) {
    steps.push({
      id: "save-account",
      title: "Save your account",
      description: "Add a passkey to sign in again later.",
      actionLabel: "Add passkey",
    });
  }

  if (state.organizationCount === 0) {
    steps.push({
      id: "create-org",
      title: "Create an organization",
      description: "Communities are run by organizations.",
      actionLabel: "Create organization",
    });
  } else if (!state.activeOrganizationName) {
    steps.push({
      id: "choose-org",
      title: "Choose an organization",
      description: `You belong to ${state.organizationCount} ${state.organizationCount === 1 ? "organization" : "organizations"}. Pick one to work in.`,
      actionLabel: "Choose",
    });
  } else if (!state.community) {
    steps.push({
      id: "start-community",
      title: "Start a community",
      description: `Propose a City Node for ${state.activeOrganizationName}.`,
      actionLabel: "Start a community",
    });
  } else {
    steps.push({
      id: "open-community",
      title: "Open My community",
      description: `${state.community.name}: events, onboarding, proposals.`,
      actionLabel: "Open",
    });
    if (state.canManageCommunity) {
      steps.push({
        id: "community-settings",
        title: "Community settings",
        description: "Domain, members and gasless writes.",
        actionLabel: "Open settings",
      });
    }
  }

  if (state.isAdmin) {
    steps.push({
      id: "admin",
      title: "Review the admin queue",
      description: "Pending proposals and tenants.",
      actionLabel: "Open admin",
    });
  }

  steps.push({
    id: "stake",
    title: "Stake NEAR",
    description: "Back a community's validator.",
    actionLabel: "Stake",
  });

  if (!state.community) {
    steps.push({
      id: "explore",
      title: "Explore communities",
      description: "See what's happening near you.",
      actionLabel: "Explore",
    });
  }

  return steps;
}
