export interface NearConnectSignerWallet {
  signMessage: (params: {
    message: string;
    recipient: string;
    nonce: Uint8Array;
    network?: string;
    callbackUrl?: string;
  }) => Promise<{ accountId: string; publicKey: string; signature: string }>;
  signDelegateActions: (params: {
    delegateActions: unknown[];
  }) => Promise<{ signedDelegateActions: string[] }>;
}

export interface NearConnectSigner {
  accountId: string;
  publicKey: string | null;
  network: "mainnet" | "testnet";
  wallet: NearConnectSignerWallet;
}

const signers = new Map<"mainnet" | "testnet", NearConnectSigner>();

export function setWalletSigner(signer: NearConnectSigner | null): void {
  if (!signer) return;
  signers.set(signer.network, signer);
}

export function clearWalletSigner(network: "mainnet" | "testnet"): void {
  signers.delete(network);
}

export function getWalletSigner(network?: "mainnet" | "testnet"): NearConnectSigner | null {
  if (network) return signers.get(network) ?? null;
  return signers.get("mainnet") ?? signers.get("testnet") ?? null;
}
