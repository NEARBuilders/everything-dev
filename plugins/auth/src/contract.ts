import type { InferContractRouterInputs, InferContractRouterOutputs } from "@orpc/contract";
import { oc } from "@orpc/contract";

import { apiKeyRoutes } from "./contract/api-keys.contract";
import { invitationRoutes } from "./contract/invitations.contract";
import { memberRoutes } from "./contract/members.contract";
import { nearRoutes } from "./contract/near.contract";
import { onboardingRoutes } from "./contract/onboarding.contract";
import { organizationRequestRoutes } from "./contract/organization-requests.contract";
import { organizationRoutes } from "./contract/organizations.contract";
import { sessionRoutes } from "./contract/session.contract";
import { teamRoutes } from "./contract/teams.contract";

export { type AuthErrors, Errors } from "./contract/errors";
export { apiKeySchema } from "./contract/schemas";

export const contract = oc.router({
  ...sessionRoutes,
  ...organizationRoutes,
  ...organizationRequestRoutes,
  ...memberRoutes,
  ...invitationRoutes,
  ...teamRoutes,
  ...onboardingRoutes,
  ...apiKeyRoutes,
  ...nearRoutes,
});

export type ContractType = typeof contract;

export type InferOutput<K extends keyof InferContractRouterOutputs<ContractType>> =
  InferContractRouterOutputs<ContractType>[K];
export type InferInput<K extends keyof InferContractRouterInputs<ContractType>> =
  InferContractRouterInputs<ContractType>[K];
