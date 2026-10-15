import type { AgentApiOptions } from "@near-intents-agent-api/sdk";
import { AgentApi } from "@near-intents-agent-api/sdk";

export type {
  AgentApiOptions,
  AgentView,
  BudgetView,
  DeletionPreview,
  ErrorDocument,
  GenerateIntentResponse,
  GenerateIntentResponseOf,
  GrantCredential,
  GrantView,
  IdempotentOptions,
  IdempotentResult,
  Intent,
  IntentPreview,
  IntentType,
  OwnerWallet,
  Policy,
  PolicyView,
  SignedData,
  StatusResponse,
  StatusResponseOf,
  StatusType,
} from "@near-intents-agent-api/sdk";
export {
  AgentApi,
  AgentApiError,
  AgentApiRequestError,
  createGrantCredential,
  createIdempotencyKey,
  grantCommitment,
} from "@near-intents-agent-api/sdk";

export function createAgentApiClient(options: AgentApiOptions): AgentApi {
  return new AgentApi(options);
}
