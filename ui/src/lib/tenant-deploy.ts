import type { TransactionBuilder } from "near-kit";
import type { ApiClient, TenantUiOverride, useAuthClient } from "@/app";
import {
  buildTenantPublishConfig,
  type SignAsDaoSpec,
  signAsDaoTransaction,
  type TenantPublishConfigInput,
} from "./dao-connect";
import { trySendWithGasKey } from "./gas-key";

const CONFIG_GAS = "300000000000000";

export type DaoTenantPublishInput = TenantPublishConfigInput;
export type TenantConfigWriteInput = TenantPublishConfigInput;

export type DaoTransactionSigner = (daoAccountId: string, spec: SignAsDaoSpec) => Promise<unknown>;

export async function prepareTenantConfigWrite(
  apiClient: ApiClient,
  input: TenantConfigWriteInput,
) {
  const config = buildTenantPublishConfig(input);
  return apiClient.apps.prepareRegistryConfigWrite({
    accountId: input.daoAccountId,
    gatewayId: input.gatewayId,
    config: config as unknown as Record<string, unknown>,
  });
}

export async function publishDaoTenantConfig(
  apiClient: ApiClient,
  input: DaoTenantPublishInput,
  signTransaction: DaoTransactionSigner = signAsDaoTransaction,
) {
  const prepared = await prepareTenantConfigWrite(apiClient, input);

  return signTransaction(input.daoAccountId, {
    receiverId: prepared.data.contractId,
    methodName: prepared.data.methodName,
    args: prepared.data.args as unknown as Record<string, unknown>,
    gas: prepared.data.gas,
    attachedDeposit: prepared.data.attachedDeposit,
  });
}

export type TenantConfigPublishMode = "platform" | "dao";

export interface TenantConfigPublishInput {
  accountId: string;
  gatewayId: string;
  baseAccount: string;
  hostname: string | null;
  title: string;
  description?: string;
  repository?: string;
  app?: { ui: TenantUiOverride };
  status?: "active" | "suspended" | "pending_deletion";
  mode: TenantConfigPublishMode;
}

type AuthClientShape = Pick<ReturnType<typeof useAuthClient>, "near">;

function networkForAccount(accountId: string): "mainnet" | "testnet" {
  return accountId.endsWith(".testnet") ? "testnet" : "mainnet";
}

/**
 * Publishes a tenant config through the signer its ownership requires: DAO
 * owners propose the write as a sputnik proposal via Trezu, platform owners
 * sign it through the relayer (or the session wallet as a fallback).
 */
export async function publishTenantConfigForMode(
  apiClient: ApiClient,
  auth: AuthClientShape,
  input: TenantConfigPublishInput,
  signTransaction: DaoTransactionSigner = signAsDaoTransaction,
) {
  if (!input.hostname) {
    throw new Error("No primary domain binding configured for this tenant");
  }

  const passthrough = {
    gatewayId: input.gatewayId,
    baseAccount: input.baseAccount,
    hostname: input.hostname,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.repository ? { repository: input.repository } : {}),
    ...(input.app ? { app: input.app } : {}),
    ...(input.status ? { status: input.status } : {}),
  };

  if (input.mode === "dao") {
    return publishDaoTenantConfig(
      apiClient,
      {
        daoAccountId: input.accountId,
        ...passthrough,
      },
      signTransaction,
    );
  }

  const connected = await auth.near.ensureConnected();
  if (!connected) {
    throw new Error("Connect a NEAR wallet first");
  }

  const signerAccountId = auth.near.getAccountId();
  if (!signerAccountId) {
    throw new Error("Connect a NEAR wallet first");
  }
  if (signerAccountId !== input.accountId) {
    throw new Error(
      `Connected NEAR account ${signerAccountId} cannot publish ${input.accountId}. Connect ${input.accountId}.`,
    );
  }

  const expectedNetwork = networkForAccount(input.accountId);
  if (auth.near.getNetwork() !== expectedNetwork) {
    throw new Error(
      `Switch your wallet to ${expectedNetwork} before publishing ${input.accountId}.`,
    );
  }

  const prepared = await prepareTenantConfigWrite(apiClient, {
    daoAccountId: input.accountId,
    ...passthrough,
  });

  const gasKeySend = await trySendWithGasKey(auth, {
    contractId: prepared.data.contractId,
    methodName: prepared.data.methodName,
    args: prepared.data.args,
    gas: prepared.data.gas,
  });
  if (gasKeySend) {
    return gasKeySend;
  }

  const relayerInfo = await auth.near.getRelayerInfo();
  const hasRelayer = relayerInfo.data?.enabled === true;

  if (hasRelayer) {
    const signed = await auth.near.buildSignedDelegateAction(
      prepared.data.contractId,
      (builder: TransactionBuilder, receiverId: string) =>
        builder.functionCall(receiverId, prepared.data.methodName, prepared.data.args, {
          gas: CONFIG_GAS,
          attachedDeposit: 0n,
        }),
    );

    const relayed = await auth.near.relayTransaction({ payload: signed });
    if (relayed.error) throw new Error(relayed.error.message);
    return relayed;
  }

  return auth.near
    .getNearClient()
    .transaction(signerAccountId)
    .functionCall(prepared.data.contractId, prepared.data.methodName, prepared.data.args, {
      gas: CONFIG_GAS,
      attachedDeposit: 0n,
    })
    .send({ waitUntil: "EXECUTED" });
}
