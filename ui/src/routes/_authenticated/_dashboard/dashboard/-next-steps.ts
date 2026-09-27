export type NextStepId = "save-account" | "create-org" | "choose-org" | "admin";

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
      description: "Nodes are owned and run by organizations.",
      actionLabel: "Create organization",
    });
  } else if (!state.activeOrganizationName) {
    steps.push({
      id: "choose-org",
      title: "Choose an organization",
      description: `You belong to ${state.organizationCount} ${state.organizationCount === 1 ? "organization" : "organizations"}. Pick one to work in.`,
      actionLabel: "Choose",
    });
  }

  if (state.isAdmin) {
    steps.push({
      id: "admin",
      title: "Review the admin queue",
      description: "Pending nodes and system health.",
      actionLabel: "Open admin",
    });
  }

  return steps;
}
