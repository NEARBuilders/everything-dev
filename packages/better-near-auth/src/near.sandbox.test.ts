import { base64, hex } from "@scure/base";
import { getTestInstance } from "better-auth/test";
import { generateKey, MlDsa65KeyPair, Near } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, describe, expect, it, vi } from "vitest";
import { siwn } from "./index.js";

vi.mock("./profile.js", () => ({
  defaultGetProfile: vi.fn(() => Promise.resolve({ name: "Quantum Tester" })),
  getImageUrl: vi.fn(() => "https://example.com/image.png"),
  getNetworkFromAccountId: vi.fn((id: string) => (id.endsWith(".testnet") ? "testnet" : "mainnet")),
}));

const RECIPIENT = "everything.test.near";
const NEP413_TAG = 2147484061;

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function borshU32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat([borshU32(bytes.length), bytes]);
}

function serializeNep413Payload(params: {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string;
}): Uint8Array {
  // borsh Option<String>: one discriminant byte, Some followed by [u32 len][bytes]
  const callbackBytes = params.callbackUrl
    ? concat([new Uint8Array([1]), borshString(params.callbackUrl)])
    : new Uint8Array([0]);
  return concat([
    borshU32(NEP413_TAG),
    borshString(params.message),
    params.nonce,
    borshString(params.recipient),
    callbackBytes,
  ]);
}

function timestampNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()), false);
  crypto.getRandomValues(nonce.subarray(8));
  return nonce;
}

let sandbox: Awaited<ReturnType<typeof Sandbox.start>> | null = null;
try {
  sandbox = await Sandbox.start();
} catch (error) {
  console.warn(
    "[sandbox-integration] near-sandbox unavailable, skipping integration tests:",
    error instanceof Error ? error.message : error,
  );
}

afterAll(async () => {
  await sandbox?.stop();
});

describe.skipIf(!sandbox)("siwn sandbox integration (real chain, real crypto)", () => {
  const ACCOUNT = "quantum.test.near";
  const NO_KEY_ACCOUNT = "keyless.test.near";

  const seed = new Uint8Array(32).fill(9);
  const pq = new MlDsa65KeyPair(seed);
  const pqPublicKey = pq.publicKey.toString();
  const ed25519 = generateKey();

  async function hexNonce(nonce: Uint8Array): Promise<string> {
    return hex.encode(nonce);
  }

  async function setup() {
    return getTestInstance(
      {
        plugins: [
          siwn({
            recipient: RECIPIENT,
            rpcUrl: { mainnet: sandbox!.rpcUrl },
          }),
        ],
      },
      { clientOptions: { plugins: [] }, disableTestUser: true },
    );
  }

  async function signPqPayload(params: {
    message: string;
    nonce: Uint8Array;
    recipient: string;
    callbackUrl?: string;
    tamper?: boolean;
  }): Promise<{ accountId: string; publicKey: string; signature: string }> {
    const serialized = serializeNep413Payload(params);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", serialized));
    const signature = pq.sign(hash);
    if (params.tamper) signature.data[0] ^= 0xff;
    return {
      accountId: ACCOUNT,
      publicKey: pqPublicKey,
      signature: base64.encode(signature.data),
    };
  }

  it("provisions sandbox accounts with an ml-dsa-65 full-access key", {
    timeout: 120_000,
  }, async () => {
    const s = sandbox!;
    const near = new Near({ network: s });
    await near
      .transaction(s.rootAccount.id)
      .createAccount(ACCOUNT)
      .transfer(ACCOUNT, "10 NEAR")
      .addKey(pqPublicKey, { type: "fullAccess" })
      .addKey(ed25519.publicKey.toString(), { type: "fullAccess" })
      .send();
    await near
      .transaction(s.rootAccount.id)
      .createAccount(NO_KEY_ACCOUNT)
      .transfer(NO_KEY_ACCOUNT, "10 NEAR")
      .addKey(generateKey().publicKey.toString(), {
        type: "fullAccess",
      })
      .send();

    const accessKey = await near.getAccessKey(ACCOUNT, pqPublicKey);
    expect(accessKey.permission).toBe("FullAccess");
  });

  it("completes an ml-dsa-65 sign-in against the real chain", { timeout: 60_000 }, async () => {
    const { client } = await setup();
    const nonce = timestampNonce();
    const message = `Sign in to ${RECIPIENT}`;
    const callbackUrl = "http://localhost:3000/login";
    const { data, error } = await client.near.verify({
      signedMessage: await signPqPayload({ message, nonce, recipient: RECIPIENT }),
      message,
      recipient: RECIPIENT,
      nonce: await hexNonce(nonce),
      accountId: ACCOUNT,
      callbackUrl,
    });
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
  });

  it("detects nonce replay on a second use", { timeout: 60_000 }, async () => {
    const { client } = await setup();
    const nonce = timestampNonce();
    const message = `Sign in to ${RECIPIENT}`;
    const body = {
      signedMessage: await signPqPayload({ message, nonce, recipient: RECIPIENT }),
      message,
      recipient: RECIPIENT,
      nonce: await hexNonce(nonce),
      accountId: ACCOUNT,
    };
    const first = await client.near.verify(body);
    expect(first.data?.success).toBe(true);
    const second = await client.near.verify(body);
    expect(second.error?.status).toBe(401);
  });

  it("rejects a tampered signature with UNAUTHORIZED_SIGNATURE_INVALID", {
    timeout: 60_000,
  }, async () => {
    const { client } = await setup();
    const message = `Sign in to ${RECIPIENT}`;
    const nonce = timestampNonce();
    const { error } = await client.near.verify({
      signedMessage: await signPqPayload({
        message,
        nonce,
        recipient: RECIPIENT,
        tamper: true,
      }),
      message,
      recipient: RECIPIENT,
      nonce: await hexNonce(nonce),
      accountId: ACCOUNT,
    });
    expect(error?.status).toBe(401);
    expect((error as { code?: string })?.code).toBe("UNAUTHORIZED_SIGNATURE_INVALID");
  });

  it("rejects when the signing key is not on the account", { timeout: 60_000 }, async () => {
    const { client } = await setup();
    const message = `Sign in to ${RECIPIENT}`;
    const nonce = timestampNonce();
    const signedMessage = await signPqPayload({ message, nonce, recipient: RECIPIENT });
    const { error } = await client.near.verify({
      signedMessage: { ...signedMessage, accountId: NO_KEY_ACCOUNT },
      message,
      recipient: RECIPIENT,
      nonce: await hexNonce(nonce),
      accountId: NO_KEY_ACCOUNT,
    });
    expect(error?.status).toBe(401);
    expect((error as { code?: string })?.code).toBe("UNAUTHORIZED_ACCESS_KEY_NOT_FOUND");
  });

  it("completes an ed25519 sign-in against the real chain", { timeout: 60_000 }, async () => {
    const { client } = await setup();
    const message = `Sign in to ${RECIPIENT}`;
    const nonce = timestampNonce();
    const signed = ed25519.signNep413Message(ACCOUNT, {
      message,
      recipient: RECIPIENT,
      nonce,
    });
    const { data, error } = await client.near.verify({
      signedMessage: {
        accountId: signed.accountId,
        publicKey: signed.publicKey,
        signature: signed.signature,
      },
      message,
      recipient: RECIPIENT,
      nonce: await hexNonce(nonce),
      accountId: ACCOUNT,
    });
    expect(error).toBeNull();
    expect(data?.success).toBe(true);
  });

  it("rejects a stale nonce with UNAUTHORIZED_NONCE_EXPIRED", { timeout: 60_000 }, async () => {
    const { client } = await setup();
    const message = `Sign in to ${RECIPIENT}`;
    const stale = new Uint8Array(32);
    new DataView(stale.buffer).setBigUint64(0, BigInt(Date.now() - 20 * 60 * 1000), false);
    crypto.getRandomValues(stale.subarray(8));
    const { error } = await client.near.verify({
      signedMessage: await signPqPayload({ message, nonce: stale, recipient: RECIPIENT }),
      message,
      recipient: RECIPIENT,
      nonce: await hexNonce(stale),
      accountId: ACCOUNT,
    });
    expect(error?.status).toBe(401);
    expect((error as { code?: string })?.code).toBe("UNAUTHORIZED_NONCE_EXPIRED");
  });
});
