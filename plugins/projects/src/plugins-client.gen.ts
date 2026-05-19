import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";

type ClientFactory<C extends AnyContractRouter> = (
  context?: Record<string, unknown>,
) => ContractRouterClient<C>;

export type PluginsClient = {
  auth: ClientFactory<AnyContractRouter>;
};
