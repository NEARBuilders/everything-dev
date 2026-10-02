export type NextStepId =
  | "save-account"
  | "add-email"
  | "create-org"
  | "choose-org"
  | "open-things"
  | "admin";

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
  hasRealEmail: boolean;
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

  if (!state.isAnonymous && !state.hasRealEmail) {
    steps.push({
      id: "add-email",
      title: "Add your email",
      description: "Sign in from another device and recover your account.",
      actionLabel: "Add email",
    });
  }

  if (state.organizationCount === 0) {
    steps.push({
      id: "create-org",
      title: "Create an organization",
      description: "Organizations keep your work in one place.",
      actionLabel: "Create organization",
    });
  } else if (!state.activeOrganizationName) {
    steps.push({
      id: "choose-org",
      title: "Choose an organization",
      description: `You belong to ${state.organizationCount} ${state.organizationCount === 1 ? "organization" : "organizations"}. Pick one to work in.`,
      actionLabel: "Choose",
    });
  } else {
    steps.push({
      id: "open-things",
      title: "Open Things",
      description: `Create and manage things for ${state.activeOrganizationName}.`,
      actionLabel: "Open Things",
    });
  }

  if (state.isAdmin) {
    steps.push({
      id: "admin",
      title: "Review the runtime",
      description: "Version and deployment details.",
      actionLabel: "Open admin",
    });
  }

  return steps;
}
