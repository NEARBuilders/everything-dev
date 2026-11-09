import { base64, hex } from "@scure/base";
import { getTestInstance } from "better-auth/test";
import { generateKey, MlDsa65KeyPair, Near } from "near-kit";
import { Sandbox } from "near-kit/sandbox";
import { afterAll, describe, expect, it, vi } from "vitest";
import { siwn } from "./index.js";

vi.mock("./profile.js", () => ({
  defaultGetProfile: vi.fn(() => Promise.resolve({ name: "Gas Tester" })),
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

function timestampNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()), false);
  crypto.getRandomValues(nonce.subarray(8));
  return nonce;
}

// Minimal wasm module exporting `__fastdata_kv` (no-op func, no imports)
function minimalKvContract(): Uint8Array {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02,
    0x01, 0x00, 0x07, 0x11, 0x01, 0x0d, 0x5f, 0x5f, 0x66, 0x61, 0x73, 0x74, 0x64, 0x61, 0x74, 0x61,
    0x5f, 0x6b, 0x76, 0x00, 0x00, 0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b,
  ]);
}

let sandbox: Awaited<ReturnType<typeof Sandbox.start>> | null = null;
try {
  sandbox = await Sandbox.start();
} catch (error) {
  console.warn(
    "[sandbox-integration] near-sandbox unavailable, skipping gas-key integration tests:",
    error instanceof Error ? error.message : error,
  );
}

afterAll(async () => {
  await sandbox?.stop();
});

describe.skipIf(!sandbox)("siwn gas-key sandbox integration (real chain, real crypto)", () => {
  const ACCOUNT = "gasuser.test.near";
  const SPONSOR = "sponsor.test.near";
  const APP = "app.test.near";

  const pq = new MlDsa65KeyPair(new Uint8Array(32).fill(21));
  const gasKey = generateKey();
  const sponsorKey = generateKey();
  const appKey = generateKey();

  async function signNep413(params: {
    message: string;
    nonce: Uint8Array;
    recipient: string;
  }): Promise<{ accountId: string; publicKey: string; signature: string }> {
    const payload = concat([
      borshU32(NEP413_TAG),
      borshString(params.message),
      params.nonce,
      borshString(params.recipient),
      new Uint8Array([0]),
    ]);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
    const signature = pq.sign(hash);
    return {
      accountId: ACCOUNT,
      publicKey: pq.publicKey.toString(),
      signature: base64.encode(signature.data),
    };
  }

  it("runs the full gasless flow: quantum login, gas-key fund, gasless write, delegate relay", {
    timeout: 180_000,
  }, async () => {
    const s = sandbox!;
    const near = new Near({ network: s });

    // 1. Provision accounts on-chain
    await near
      .transaction(s.rootAccount.id)
      .createAccount(SPONSOR)
      .transfer(SPONSOR, "100 NEAR")
      .addKey(sponsorKey.publicKey.toString(), { type: "fullAccess" })
      .send();
    await near
      .transaction(s.rootAccount.id)
      .createAccount(ACCOUNT)
      .transfer(ACCOUNT, "10 NEAR")
      .addKey(pq.publicKey.toString(), { type: "fullAccess" })
      .send();
    await near
      .transaction(s.rootAccount.id)
      .createAccount(APP)
      .transfer(APP, "10 NEAR")
      .addKey(appKey.publicKey.toString(), { type: "fullAccess" })
      .send();
    await new Near({ network: s })
      .transaction(APP)
      .signWith(appKey.secretKey)
      .deployContract(APP, minimalKvContract())
      .send();

    // 2. Server instance pointing at the sandbox, explicit sponsor relayer,
    //    session gas keys scoped to the contract
    const { customFetchImpl } = await getTestInstance(
      {
        plugins: [
          siwn({
            recipient: RECIPIENT,
            rpcUrl: { mainnet: s.rpcUrl },
            relayer: {
              accountId: SPONSOR,
              privateKey: sponsorKey.secretKey,
              whitelistedContracts: [APP],
            },
            sessionGasKey: {
              receiverId: APP,
              methodNames: ["__fastdata_kv"],
              fundAmount: "0.05 NEAR",
              topUpThreshold: "0.01 NEAR",
              maxFundPerUser: "0.2 NEAR",
              numNonces: 4,
            },
          }),
        ],
      },
      { clientOptions: { plugins: [] }, disableTestUser: true },
    );

    // 3. Quantum SIWN login -> session cookie
    const loginNonce = timestampNonce();
    const loginMessage = `Sign in to ${RECIPIENT}`;
    const login = await customFetchImpl("http://localhost/api/auth/near/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedMessage: await signNep413({
          message: loginMessage,
          nonce: loginNonce,
          recipient: RECIPIENT,
        }),
        message: loginMessage,
        recipient: RECIPIENT,
        nonce: hex.encode(loginNonce),
        accountId: ACCOUNT,
      }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") || "";
    expect(cookie).not.toBe("");

    // 4. Bootstrap the session gas key (the browser signs this AddKey with the
    //    wallet — here the quantum parent signs it directly on-chain)
    await near
      .transaction(ACCOUNT)
      .signWith(pq.secretKey)
      .addKey(gasKey.publicKey.toString(), {
        type: "gasKeyFunctionCall",
        numNonces: 4,
        receiverId: APP,
        methodNames: ["__fastdata_kv"],
      })
      .send();

    // 5. Fund it through the server route (sponsor transferToGasKey on-chain)
    const fundRes = await customFetchImpl("http://localhost/api/auth/near/gas-key/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ accountId: ACCOUNT, publicKey: gasKey.publicKey.toString() }),
    });
    expect(fundRes.status).toBe(200);
    const funded = (await fundRes.json()) as { amountFunded?: string };
    expect(funded.amountFunded).toBe("50000000000000000000000");

    const fundedView = await near.getAccessKey(ACCOUNT, gasKey.publicKey.toString());
    const permission = fundedView.permission as { GasKeyFunctionCall?: { balance: string } };
    expect(permission.GasKeyFunctionCall?.balance).toBe("50000000000000000000000");

    // 6. Gasless write: the gas key signs a direct tx on its own nonce lane,
    //    gas paid from the key's prepaid balance (mirrors sendWithGasKey)
    const writeResult = await new Near({ network: s })
      .transaction(ACCOUNT)
      .signWith(gasKey.secretKey)
      .useGasKey(0)
      .functionCall(APP, "__fastdata_kv", {}, { gas: "30 Tgas" })
      .send({ waitUntil: "EXECUTED" });
    expect(writeResult.transaction.hash).toBeTruthy();

    const afterWrite = await near.getAccessKey(ACCOUNT, gasKey.publicKey.toString());
    const afterPermission = afterWrite.permission as {
      GasKeyFunctionCall?: { balance: string };
    };
    expect(BigInt(afterPermission.GasKeyFunctionCall?.balance ?? "0")).toBeLessThan(
      50_000_000_000_000_000_000_000n,
    );

    // 7. Relay: quantum parent signs the delegate, sponsor submits on-chain
    const delegate = await new Near({ network: s })
      .transaction(ACCOUNT)
      .signWith(pq.secretKey)
      .functionCall(APP, "__fastdata_kv", {}, { gas: "30 Tgas" })
      .delegate({ receiverId: APP });
    const relayRes = await customFetchImpl("http://localhost/api/auth/near/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ payload: delegate.payload }),
    });
    const relayBody = await relayRes.text();
    expect(relayRes.status, `relay body: ${relayBody}`).toBe(200);
    const relayed = JSON.parse(relayBody) as { txHash?: string };
    expect(relayed.txHash).toBeTruthy();

    // 8. History reflects the relayed transaction
    const historyRes = await customFetchImpl("http://localhost/api/auth/near/relay-history", {
      method: "GET",
      headers: { cookie },
    });
    expect(historyRes.status).toBe(200);
    const history = (await historyRes.json()) as { transactions?: Array<{ txHash?: string }> };
    expect(history.transactions?.some((t) => t.txHash === relayed.txHash)).toBe(true);
  });
});
