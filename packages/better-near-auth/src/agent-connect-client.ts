import type { GenerateIntentResponse, SignedData } from "@near-intents-agent-api/sdk";
import { getWalletSigner } from "./wallet-signer.js";

/**
 * Client-side agent wallet signing — the wallet-plumbing half of the BFF
 * split. The server half (intent preparation, submission, grant vault) lives
 * in the `agent-connect` plugin; this surface only signs a generated
 * `intent.payload` with the connected wallet and returns the wallet's output,
 * byte-for-byte, for the plugin's submit route.
 */

export async function signAgentIntent(generated: GenerateIntentResponse): Promise<SignedData> {
  const { standard, payload } = generated.intent;

  if (standard === "nep413") {
    const signer = getWalletSigner();
    if (!signer) {
      throw new Error("Connect your NEAR wallet first to sign this intent");
    }
    const nonce = Uint8Array.from(atob(payload.nonce), (c) => c.charCodeAt(0));
    const signedMessage = await signer.wallet.signMessage({
      message: payload.message,
      recipient: payload.recipient,
      nonce,
      network: signer.network,
    });
    return {
      standard,
      payload,
      public_key: signedMessage.publicKey,
      signature: signedMessage.signature,
    };
  }

  if (standard === "nep366") {
    const signer = getWalletSigner();
    if (!signer) {
      throw new Error("Connect your NEAR wallet first to sign this intent");
    }
    const result = await signer.wallet.signDelegateActions({ delegateActions: [payload] });
    const signedDelegate = result.signedDelegateActions[0];
    if (!signedDelegate) {
      throw new Error("Wallet returned no signed delegate action");
    }
    return { standard, payload, signed_delegate: signedDelegate };
  }

  if (standard === "webauthn") {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const credential = await startAuthentication({
      optionsJSON: payload as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
    return { standard, payload, credential } as SignedData;
  }

  throw new Error(`Unsupported intent signing standard: ${standard}`);
}
