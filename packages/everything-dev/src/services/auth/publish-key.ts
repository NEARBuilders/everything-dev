import { Effect } from "effect";
import { addFunctionCallAccessKey, ensureNearCli, listPublishKeys } from "../../near-cli";
import { getNetworkIdForAccount } from "../../network";
import { getRegistryNamespaceForAccount } from "../registry/fastkv";

/** The FC methods a publish key is scoped to. */
export const PUBLISH_FUNCTION_NAMES = ["__fastdata_kv"];

/**
 * The publish-key mint shared by `bos key generate` and `login --key`'s
 * export (ticket #423): ensure the near CLI, resolve the network + registry
 * namespace, list any existing publish keys, and add a scoped function-call
 * key. Callers decide what to do with the listing and the key material.
 */
export async function mintPublishKey(input: {
  account: string;
  registry?: string;
  allowance?: string;
  functionNames?: string[];
}): Promise<{
  keyPair: { publicKey: string; privateKey: string };
  network: "mainnet" | "testnet";
  contract: string;
  oldKeys: string[];
}> {
  if (!input.account) {
    throw new Error("the authored config has no account to export a publish key for");
  }

  await Effect.runPromise(ensureNearCli);

  const network = getNetworkIdForAccount(input.account);
  const contract = getRegistryNamespaceForAccount(input.account, input.registry);
  const functionNames = input.functionNames ?? PUBLISH_FUNCTION_NAMES;
  const oldKeys = await listPublishKeys({ account: input.account, contract, network });

  const keyPair = await addFunctionCallAccessKey({
    account: input.account,
    contract,
    allowance: input.allowance ?? "1NEAR",
    functionNames,
    network,
  });

  return { keyPair, network, contract, oldKeys };
}
