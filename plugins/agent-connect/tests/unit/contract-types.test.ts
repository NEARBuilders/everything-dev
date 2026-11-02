import type { GenerateIntentResponse, StatusResponse } from "@near-intents-agent-api/sdk";
import type { ContractRouterClient } from "@orpc/contract";
import { describe, expectTypeOf, it } from "vitest";
import type { contract } from "@/contract";

/**
 * Type-level drift gate: the generated oRPC client's outputs must be the
 * SDK's own types, so the wallet-signing helper (`signAgentIntent`) and the
 * upcoming UI consume route responses without casts.
 */
describe("contract type fidelity", () => {
  type Client = ContractRouterClient<typeof contract>;

  it("agentCreate/prepareIntent return the SDK's GenerateIntentResponse", () => {
    type Prepared = Awaited<ReturnType<Client["agentCreate"]>>;
    expectTypeOf<Prepared>().toExtend<GenerateIntentResponse>();
    expectTypeOf<Awaited<ReturnType<Client["prepareIntent"]>>>().toExtend<GenerateIntentResponse>();
  });

  it("intentSubmit/intentStatus return the SDK's StatusResponse", () => {
    expectTypeOf<Awaited<ReturnType<Client["intentSubmit"]>>>().toExtend<StatusResponse>();
    expectTypeOf<Awaited<ReturnType<Client["intentStatus"]>>>().toExtend<StatusResponse>();
  });
});
