import { isPrivateKey, Near, type PrivateKey } from "near-kit";
import type { NetworkId } from "../registry/fastkv";
import { openInBrowser, startDeviceLogin } from "./device-login";
import { generateNearKeyPair } from "./near-cli";
import { type DelegateKeyRecord, readSessionHandle, updateSessionHandle } from "./session";
import { authPost as realAuthPost, type SiteClientShape } from "./site-client";

const realSiteClient = { authPost: realAuthPost } as Pick<SiteClientShape, "authPost">;

export interface RelayResult {
  success: true;
  txHash?: string;
}

export interface DelegateSubmitOptions {
  account: string;
  contract: string;
  network: NetworkId;
  args: Record<string, string>;
  delegatePrivateKey: string;
  relayEndpoint: string;
  apiKey: string;
  gas?: string;
}

function relayErrorMessage(message: string): string {
  return message.replace(/\n/g, " ");
}

export async function submitRegistryWriteDelegated(
  opts: DelegateSubmitOptions,
  siteClient: Pick<SiteClientShape, "authPost"> = realSiteClient,
): Promise<RelayResult> {
  const near = new Near({
    network: opts.network,
    defaultSignerId: opts.account,
    privateKey: assertPrivateKey(opts.delegatePrivateKey),
  });

  const delegate = await near
    .transaction(opts.account)
    .functionCall(opts.contract, "__fastdata_kv", opts.args, {
      gas: "300 Tgas",
      attachedDeposit: "0 yocto",
    })
    .delegate({ receiverId: opts.contract, blockHeightOffset: 200 });

  const { status, json } = await siteClient.authPost(
    opts.relayEndpoint.replace(/\/api\/auth\/near\/relay$/, ""),
    "/near/relay",
    { payload: delegate.payload },
    undefined,
    { "x-api-key": opts.apiKey },
  );

  if (status >= 400) {
    let detail = `Relay rejected the transaction (HTTP ${status})`;
    const relayMessage =
      typeof (json as { message?: string }).message === "string"
        ? (json as { message: string }).message
        : typeof (json as { error?: string }).error === "string"
          ? (json as { error: string }).error
          : undefined;
    if (relayMessage) {
      detail = `${detail}: ${relayErrorMessage(relayMessage)}`;
    }
    throw new Error(detail);
  }

  const body = json as { txHash?: string };
  return { success: true, txHash: body.txHash };
}

function assertPrivateKey(key: string): PrivateKey {
  if (!isPrivateKey(key)) {
    throw new Error("Invalid delegate key format (expected ed25519:…)");
  }
  return key as PrivateKey;
}

export interface EnsureDelegateKeyOptions {
  configDir: string;
  account: string;
  contract: string;
  network: NetworkId;
  siteUrl: string;
}

export async function ensureDelegateKey(
  opts: EnsureDelegateKeyOptions,
): Promise<DelegateKeyRecord> {
  const existing = readSessionHandle(opts.configDir)?.delegateKey;
  if (
    existing &&
    existing.accountId === opts.account &&
    existing.contract === opts.contract &&
    existing.network === opts.network
  ) {
    return existing;
  }

  const keyPair = generateNearKeyPair();

  const login = await startDeviceLogin({
    siteUrl: opts.siteUrl,
    delegate: {
      pubKey: keyPair.publicKey,
      contract: opts.contract,
      network: opts.network,
    },
    account: opts.account,
  });

  console.log(`  One-time code: ${login.userCode}`);
  await openInBrowser(login.verificationUrl).catch((error: unknown) => {
    console.log(`  ⚠ ${(error as Error).message}`);
  });
  console.log(`  Waiting for delegate-key approval at ${login.verificationUrl}…`);

  await login.waitForApproval();

  const record: DelegateKeyRecord = {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    accountId: opts.account,
    network: opts.network,
    contract: opts.contract,
    mintedAt: new Date().toISOString(),
  };
  updateSessionHandle(opts.configDir, (current) => ({ ...current, delegateKey: record }));
  return record;
}
