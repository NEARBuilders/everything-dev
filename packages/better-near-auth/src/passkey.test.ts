import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64, base64url } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  computeNep413Challenge,
  derivePasskeyAccountId,
  getPasskeyWalletFactory,
  isDeterministicAccountId,
  verifyPasskeyNep413Signature,
} from "./passkey";

const MESSAGE = "Sign in to test.near";
const RECIPIENT = "test.near";

function fabricateAssertion(challenge: Uint8Array) {
  const privateKey = ed25519.keygen().secretKey;
  const publicKeyBytes = ed25519.getPublicKey(privateKey);

  const rpId = "localhost";
  const rpIdHash = sha256(new TextEncoder().encode(rpId));
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(rpIdHash, 0);
  authenticatorData[32] = 0x05; // UP | UV
  new DataView(authenticatorData.buffer).setUint32(33, 1, false);

  const clientDataJson = JSON.stringify({
    type: "webauthn.get",
    challenge: base64url.encode(challenge),
    origin: `https://${rpId}`,
  });
  const clientDataBytes = new TextEncoder().encode(clientDataJson);

  const signedBytes = new Uint8Array(authenticatorData.length + 32);
  signedBytes.set(authenticatorData);
  signedBytes.set(sha256(clientDataBytes), authenticatorData.length);

  const signature = ed25519.sign(signedBytes, privateKey);

  const proof = JSON.stringify({
    authenticator_data: base64url.encode(authenticatorData),
    client_data_json: clientDataJson,
    signature: `ed25519:${base58.encode(signature)}`,
  });

  const publicKey = `ed25519:${base58.encode(publicKeyBytes)}`;
  return {
    accountId: derivePasskeyAccountId(publicKey)!,
    publicKey,
    signature: base64.encode(new TextEncoder().encode(proof)),
  };
}

describe("verifyPasskeyNep413Signature", () => {
  it("accepts a valid passkey-signed NEP-413 message for the derived deterministic account", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signedMessage = fabricateAssertion(computeNep413Challenge(MESSAGE, RECIPIENT, nonce));

    expect(isDeterministicAccountId(signedMessage.accountId)).toBe(true);
    expect(
      verifyPasskeyNep413Signature({
        accountId: signedMessage.accountId,
        publicKey: signedMessage.publicKey,
        signature: signedMessage.signature,
        message: MESSAGE,
        recipient: RECIPIENT,
        nonce,
      }),
    ).toBe(true);
  });

  it("rejects when the message payload does not match the signed challenge", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signedMessage = fabricateAssertion(computeNep413Challenge(MESSAGE, RECIPIENT, nonce));

    expect(
      verifyPasskeyNep413Signature({
        accountId: signedMessage.accountId,
        publicKey: signedMessage.publicKey,
        signature: signedMessage.signature,
        message: `${MESSAGE} tampered`,
        recipient: RECIPIENT,
        nonce,
      }),
    ).toBe(false);
  });

  it("rejects a mismatched recipient", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signedMessage = fabricateAssertion(computeNep413Challenge(MESSAGE, RECIPIENT, nonce));

    expect(
      verifyPasskeyNep413Signature({
        accountId: signedMessage.accountId,
        publicKey: signedMessage.publicKey,
        signature: signedMessage.signature,
        message: MESSAGE,
        recipient: "other.near",
        nonce,
      }),
    ).toBe(false);
  });

  it("rejects an account id that does not match the public key derivation", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signedMessage = fabricateAssertion(computeNep413Challenge(MESSAGE, RECIPIENT, nonce));

    expect(
      verifyPasskeyNep413Signature({
        accountId: "0s0000000000000000000000000000000000000000",
        publicKey: signedMessage.publicKey,
        signature: signedMessage.signature,
        message: MESSAGE,
        recipient: RECIPIENT,
        nonce,
      }),
    ).toBe(false);
  });

  it("rejects non-deterministic account ids outright", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signedMessage = fabricateAssertion(computeNep413Challenge(MESSAGE, RECIPIENT, nonce));

    expect(
      verifyPasskeyNep413Signature({
        accountId: "alice.near",
        publicKey: signedMessage.publicKey,
        signature: signedMessage.signature,
        message: MESSAGE,
        recipient: RECIPIENT,
        nonce,
      }),
    ).toBe(false);
  });

  it("rejects a tampered proof blob", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const signedMessage = fabricateAssertion(computeNep413Challenge(MESSAGE, RECIPIENT, nonce));
    const proof = JSON.parse(new TextDecoder().decode(base64.decode(signedMessage.signature))) as {
      authenticator_data: string;
    };
    const authData = base64url.decode(proof.authenticator_data);
    authData[33] = 0x99;
    const tampered = base64.encode(
      new TextEncoder().encode(
        JSON.stringify({ ...proof, authenticator_data: base64url.encode(authData) }),
      ),
    );

    expect(
      verifyPasskeyNep413Signature({
        accountId: signedMessage.accountId,
        publicKey: signedMessage.publicKey,
        signature: tampered,
        message: MESSAGE,
        recipient: RECIPIENT,
        nonce,
      }),
    ).toBe(false);
  });

  it("rejects assertions without user verification", () => {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const challenge = computeNep413Challenge(MESSAGE, RECIPIENT, nonce);
    const signedMessage = fabricateAssertion(challenge);

    const proof = JSON.parse(new TextDecoder().decode(base64.decode(signedMessage.signature))) as {
      authenticator_data: string;
    };
    const authData = base64url.decode(proof.authenticator_data);
    authData[32] = 0x01; // UP only, no UV

    expect(
      verifyPasskeyNep413Signature({
        accountId: signedMessage.accountId,
        publicKey: signedMessage.publicKey,
        signature: base64.encode(
          new TextEncoder().encode(
            JSON.stringify({ ...proof, authenticator_data: base64url.encode(authData) }),
          ),
        ),
        message: MESSAGE,
        recipient: RECIPIENT,
        nonce,
      }),
    ).toBe(false);
  });
});

describe("getPasskeyWalletFactory", () => {
  it("selects the P-256 passkey wallet factory on mainnet", () => {
    expect(getPasskeyWalletFactory("mainnet", "p256")).toBe(
      "p256-passkey-wallet-contract.trezu.near",
    );
  });

  it("selects the Ed25519 passkey wallet factory on mainnet", () => {
    expect(getPasskeyWalletFactory("mainnet", "ed25519")).toBe(
      "ed25519-passkey-wallet-contract.trezu.near",
    );
  });

  it("has no passkey wallet factory on testnet", () => {
    expect(getPasskeyWalletFactory("testnet", "p256")).toBeNull();
    expect(getPasskeyWalletFactory("testnet", "ed25519")).toBeNull();
  });
});

describe("derivePasskeyAccountId", () => {
  const publicKey = `ed25519:${base58.encode(ed25519.getPublicKey(ed25519.keygen().secretKey))}`;

  it("derives the mainnet account by default", () => {
    expect(derivePasskeyAccountId(publicKey)).toBe(derivePasskeyAccountId(publicKey, "mainnet"));
    expect(isDeterministicAccountId(derivePasskeyAccountId(publicKey) ?? "")).toBe(true);
  });

  it("derives no account on a network without a passkey wallet factory", () => {
    expect(derivePasskeyAccountId(publicKey, "testnet")).toBeNull();
  });
});
