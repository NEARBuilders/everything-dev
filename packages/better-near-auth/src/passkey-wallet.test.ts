import { createPrivateKey, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, base64, base64url } from "@scure/base";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import { type SIWNPluginOptions, siwn } from "./index.js";
import { computeNep413Challenge } from "./passkey.js";

const MOCK_RECIPIENT = "example.near";
const RP_ID = "localhost";

function makeUniqueNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function coseForP256(x: Uint8Array, y: Uint8Array): Uint8Array {
  if (x.length !== 32 || y.length !== 32) throw new Error("expected 32-byte coordinates");
  return new Uint8Array([
    0xa5,
    0x01,
    0x02,
    0x03,
    0x26,
    0x20,
    0x01,
    0x21,
    0x58,
    0x20,
    ...x,
    0x22,
    0x58,
    0x20,
    ...y,
  ]);
}

interface P256Keypair {
  x: Uint8Array;
  y: Uint8Array;
  derSign: (data: Uint8Array) => Uint8Array;
}

function generateP256(): P256Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  return {
    x: base64url.decode(jwk.x!.padEnd(Math.ceil(jwk.x!.length / 4) * 4, "=")),
    y: base64url.decode(jwk.y!.padEnd(Math.ceil(jwk.y!.length / 4) * 4, "=")),
    derSign: (data: Uint8Array) =>
      new Uint8Array(
        nodeSign(
          "sha256",
          data,
          createPrivateKey(privateKey.export({ format: "pem", type: "sec1" }) as string),
        ),
      ),
  };
}

function buildAssertion(keypair: P256Keypair, nonce: Uint8Array) {
  const recipient = MOCK_RECIPIENT;
  const message = `Sign in to ${recipient}`;
  const challenge = computeNep413Challenge(message, recipient, nonce);

  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(sha256(new TextEncoder().encode(RP_ID)), 0);
  authenticatorData[32] = 0x05;
  new DataView(authenticatorData.buffer).setUint32(33, 1, false);
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: "webauthn.get",
      challenge: base64url.encode(new Uint8Array(challenge)),
      origin: `https://${RP_ID}`,
    }),
  );
  const signedBytes = new Uint8Array(authenticatorData.length + 32);
  signedBytes.set(authenticatorData);
  signedBytes.set(sha256(clientDataJSON), authenticatorData.length);

  const parsed = p256.Signature.fromBytes(keypair.derSign(signedBytes), "der");
  const order = p256.Point.Fn.ORDER;
  const normalized =
    parsed.s * 2n > order ? new p256.Signature(parsed.r, order - parsed.s) : parsed;
  const proof = base64.encode(
    new TextEncoder().encode(
      JSON.stringify({
        authenticator_data: base64url.encode(authenticatorData),
        client_data_json: new TextDecoder().decode(clientDataJSON),
        signature: `p256:${base58.encode(normalized.toBytes("compact"))}`,
      }),
    ),
  );
  return { nonce, proof };
}

async function setup(keypair: P256Keypair, siwnOptions: Partial<SIWNPluginOptions> = {}) {
  const { auth, customFetchImpl, signInWithTestUser } = await getTestInstance({
    plugins: [
      siwn({ recipient: MOCK_RECIPIENT, ...siwnOptions } as SIWNPluginOptions),
      passkey({ rpID: RP_ID, rpName: "Test", origin: "http://localhost" }),
    ],
  });
  const { headers } = await signInWithTestUser();
  const sessionRes = await customFetchImpl("http://localhost/api/auth/get-session", {
    headers: { cookie: headers.get("cookie") ?? "" },
  });
  const session = (await sessionRes.json()) as { user: { id: string } };
  const context = await auth.$context;
  await context.adapter.create({
    model: "passkey",
    data: {
      id: crypto.randomUUID(),
      userId: session.user.id,
      credentialID: `cred-${crypto.randomUUID()}`,
      publicKey: base64.encode(coseForP256(keypair.x, keypair.y)),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "",
      createdAt: new Date(),
    },
  });
  const link = async (nonce: Uint8Array, proof: string) => {
    return customFetchImpl("http://localhost/api/auth/near/link-passkey-wallet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: headers.get("cookie") ?? "",
      },
      body: JSON.stringify({ nonce: Buffer.from(nonce).toString("hex"), proof }),
    });
  };
  return { auth, link, userId: session.user.id, context };
}

describe("link-passkey-wallet", () => {
  it("links the derived 0s… account from a stored passkey credential", async () => {
    const keypair = generateP256();
    const { link, context } = await setup(keypair);

    const { nonce, proof } = buildAssertion(keypair, makeUniqueNonce());
    const res = await link(nonce, proof);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; accountId: string; network: string };
    expect(body.success).toBe(true);
    expect(body.accountId).toMatch(/^0s[0-9a-f]{40}$/);
    expect(body.network).toBe("mainnet");

    const nearAccount = await context.adapter.findOne({
      model: "nearAccount",
      where: [{ field: "accountId", operator: "eq", value: body.accountId }],
    });
    expect(nearAccount).not.toBeNull();
    expect(nearAccount?.publicKey).toMatch(/^p256:/);
  });

  it("rejects an assertion over a different challenge", async () => {
    const keypair = generateP256();
    const { link } = await setup(keypair);

    const { nonce, proof } = buildAssertion(keypair, makeUniqueNonce());
    const res = await link(nonce, proof);
    expect(res.status).toBe(200);

    const replay = await link(nonce, proof);
    expect(replay.status).toBe(401);
  });

  it("rejects a signature from a different key", async () => {
    const keypair = generateP256();
    const impostor = generateP256();
    const { link } = await setup(keypair);

    const { nonce } = buildAssertion(keypair, makeUniqueNonce());
    const impostorAssertion = buildAssertion(impostor, nonce);
    const res = await link(nonce, impostorAssertion.proof);
    expect(res.status).toBe(401);
  });

  it("enforces user verification on the assertion", async () => {
    const keypair = generateP256();
    const { link } = await setup(keypair);

    const nonce = makeUniqueNonce();
    const recipient = MOCK_RECIPIENT;
    const message = `Sign in to ${recipient}`;
    const challenge = computeNep413Challenge(message, recipient, nonce);
    const authenticatorData = new Uint8Array(37);
    authenticatorData.set(sha256(new TextEncoder().encode(RP_ID)), 0);
    authenticatorData[32] = 0x01;
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({
        type: "webauthn.get",
        challenge: base64url.encode(new Uint8Array(challenge)),
        origin: `https://${RP_ID}`,
      }),
    );
    const signedBytes = new Uint8Array(authenticatorData.length + 32);
    signedBytes.set(authenticatorData);
    signedBytes.set(sha256(clientDataJSON), authenticatorData.length);
    const parsed = p256.Signature.fromBytes(keypair.derSign(signedBytes), "der");
    const proof = base64.encode(
      new TextEncoder().encode(
        JSON.stringify({
          authenticator_data: base64url.encode(authenticatorData),
          client_data_json: new TextDecoder().decode(clientDataJSON),
          signature: `p256:${base58.encode(parsed.toBytes("compact"))}`,
        }),
      ),
    );
    const res = await link(nonce, proof);
    expect(res.status).toBe(401);
  });
});

describe("link-passkey-wallet network", () => {
  it("reports the passkey wallet as unavailable on a network without a factory", async () => {
    const keypair = generateP256();
    const { link, context, userId } = await setup(keypair, { passkeyWalletNetwork: "testnet" });

    const { nonce, proof } = buildAssertion(keypair, makeUniqueNonce());
    const res = await link(nonce, proof);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      network: "testnet",
      reason: "PASSKEY_WALLET_UNAVAILABLE",
    });

    const linked = await context.adapter.findMany({
      model: "nearAccount",
      where: [{ field: "userId", operator: "eq", value: userId }],
    });
    expect(linked).toEqual([]);
  });

  it("keeps an existing primary NEAR account primary when linking a passkey wallet", async () => {
    const keypair = generateP256();
    const { link, context, userId } = await setup(keypair);
    await context.adapter.create({
      model: "nearAccount",
      data: {
        userId,
        accountId: "alice.near",
        network: "mainnet",
        publicKey: "ed25519:placeholder",
        isPrimary: true,
        createdAt: new Date(),
      },
    });

    const { nonce, proof } = buildAssertion(keypair, makeUniqueNonce());
    const res = await link(nonce, proof);
    const body = (await res.json()) as { accountId: string };

    const passkeyWallet = await context.adapter.findOne<{ isPrimary: boolean }>({
      model: "nearAccount",
      where: [{ field: "accountId", operator: "eq", value: body.accountId }],
    });
    expect(passkeyWallet?.isPrimary).toBe(false);
  });
});
