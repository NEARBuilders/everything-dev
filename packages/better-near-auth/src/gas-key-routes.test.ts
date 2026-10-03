import { hex } from "@scure/base";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it, vi } from "vitest";
import { siwn } from "./index.js";

const MOCK_ACCOUNT_ID = "test.near";
const MOCK_RECIPIENT = "example.near";
const MOCK_PUBLIC_KEY = "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD";

const GAS_KEY_VIEW = {
  nonce: 0,
  block_height: 1000,
  block_hash: "0",
  permission: {
    GasKeyFunctionCall: {
      balance: "1000000000000000000000",
      num_nonces: 4,
      receiver_id: "dev.allthethings.testnet",
      method_names: ["__fastdata_kv"],
    },
  },
};

let mockAccessKeyView: unknown = GAS_KEY_VIEW;
const sendTx = vi.fn(() => Promise.resolve({ transaction: { hash: "sponsor-tx-hash" } }));
const transferToGasKey = vi.fn().mockReturnValue({ send: sendTx });
vi.mock("near-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("near-kit")>();
  return {
    ...actual,
    Near: vi.fn(function NearMock() {
      return {
        getAccessKey: vi.fn(() => Promise.resolve(mockAccessKeyView)),
        transaction: vi.fn(() => ({
          transferToGasKey,
          send: sendTx,
        })),
      };
    }),
    verifyNep413Signature: vi.fn(() => Promise.resolve(true)),
  };
});

let nonceCounter = 0;
function makeUniqueNonce(): Uint8Array {
  nonceCounter++;
  const nonce = new Uint8Array(32);
  for (let i = 0; i < 32; i++) nonce[i] = (i + 1) ^ (nonceCounter & 0xff);
  return nonce;
}

const mockSignedMessage = {
  accountId: MOCK_ACCOUNT_ID,
  publicKey: MOCK_PUBLIC_KEY,
  signature: "mock-signature-base64",
};

function makeVerifyBody() {
  const nonceBytes = makeUniqueNonce();
  const nonceHex = hex.encode(nonceBytes);
  return {
    signedMessage: mockSignedMessage,
    message: `Sign in to ${MOCK_RECIPIENT}`,
    recipient: MOCK_RECIPIENT,
    nonce: nonceHex,
    accountId: MOCK_ACCOUNT_ID,
  };
}

const SESSION_GAS_KEY = {
  receiverId: "dev.allthethings.testnet",
  methodNames: ["__fastdata_kv"],
  fundAmount: "0.05 NEAR",
  topUpThreshold: "0.01 NEAR",
  maxFundPerUser: "0.2 NEAR",
  numNonces: 4,
};

async function setup(overrides?: { sessionGasKey?: unknown; relayer?: unknown }) {
  const siwnOptions = {
    recipient: MOCK_RECIPIENT,
    relayer: overrides?.relayer ?? {
      accountId: "sponsor.testnet",
      privateKey: "ed25519:mocksponsorkey",
    },
    validateLimitedAccessKey: async () => true,
  } as Parameters<typeof siwn>[0];
  if (overrides && "sessionGasKey" in overrides) {
    (siwnOptions as { sessionGasKey?: unknown }).sessionGasKey = overrides.sessionGasKey;
  } else {
    (siwnOptions as { sessionGasKey?: unknown }).sessionGasKey = SESSION_GAS_KEY;
  }
  return getTestInstance(
    {
      plugins: [siwn(siwnOptions)],
    },
    {
      clientOptions: { plugins: [] },
      disableTestUser: true,
    },
  );
}

async function verifyWithCookie(customFetchImpl: (r: string, o?: unknown) => Promise<Response>) {
  const res = await customFetchImpl("http://localhost/api/auth/near/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeVerifyBody()),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") || "";
  expect(cookie).not.toBe("");
  return cookie;
}

function fundWithCookie(
  customFetchImpl: (r: string, o?: unknown) => Promise<Response>,
  cookie: string,
  body: object,
) {
  return customFetchImpl("http://localhost/api/auth/near/gas-key/fund", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("session gas key routes", () => {
  vi.setConfig({ testTimeout: 30_000 });

  it("scope returns the configured scope for the session network", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await customFetchImpl("http://localhost/api/auth/near/gas-key/scope", {
      method: "GET",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.receiverId).toBe("dev.allthethings.testnet");
    expect(body.methodNames).toEqual(["__fastdata_kv"]);
    expect(body.topUpThresholdYocto).toBe("10000000000000000000000");
  });

  it("scope reports disabled when sessionGasKey is unconfigured", async () => {
    const { customFetchImpl } = await setup({ sessionGasKey: undefined });
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await customFetchImpl("http://localhost/api/auth/near/gas-key/scope", {
      method: "GET",
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });

  it("refuses unauthenticated funding", async () => {
    const { customFetchImpl } = await setup();
    const res = await fundWithCookie(customFetchImpl, "", {
      accountId: MOCK_ACCOUNT_ID,
      publicKey: MOCK_PUBLIC_KEY,
    });
    expect(res.status).toBe(401);
  });

  it("refuses funding for an account that is not the session account", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await fundWithCookie(customFetchImpl, cookie, {
      accountId: "other.near",
      publicKey: MOCK_PUBLIC_KEY,
    });
    expect(res.status).toBe(401);
  });

  it("funds a scoped gas key below the threshold and records it", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await fundWithCookie(customFetchImpl, cookie, {
      accountId: MOCK_ACCOUNT_ID,
      publicKey: MOCK_PUBLIC_KEY,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txHash).toBe("sponsor-tx-hash");
    expect(body.amountFunded).toBe("50000000000000000000000");

    expect(transferToGasKey).toHaveBeenCalledWith(MOCK_PUBLIC_KEY, 50000000000000000000000n);
  });

  it("refunds refusal: balance above the top-up threshold is rejected", async () => {
    mockAccessKeyView = {
      ...GAS_KEY_VIEW,
      permission: {
        GasKeyFunctionCall: {
          ...(GAS_KEY_VIEW.permission as { GasKeyFunctionCall: object }).GasKeyFunctionCall,
          balance: "90000000000000000000000",
        },
      },
    };
    try {
      const { customFetchImpl } = await setup();
      const cookie = await verifyWithCookie(customFetchImpl);

      const res = await fundWithCookie(customFetchImpl, cookie, {
        accountId: MOCK_ACCOUNT_ID,
        publicKey: MOCK_PUBLIC_KEY,
      });
      expect(res.status).toBe(400);
    } finally {
      mockAccessKeyView = GAS_KEY_VIEW;
    }
  });

  it("refuses keys scoped outside the configured receiver", async () => {
    mockAccessKeyView = {
      ...GAS_KEY_VIEW,
      permission: {
        GasKeyFunctionCall: {
          ...(GAS_KEY_VIEW.permission as { GasKeyFunctionCall: object }).GasKeyFunctionCall,
          receiver_id: "other.contract.testnet",
        },
      },
    };
    try {
      const { customFetchImpl } = await setup();
      const cookie = await verifyWithCookie(customFetchImpl);

      const res = await fundWithCookie(customFetchImpl, cookie, {
        accountId: MOCK_ACCOUNT_ID,
        publicKey: MOCK_PUBLIC_KEY,
      });
      expect(res.status).toBe(403);
    } finally {
      mockAccessKeyView = GAS_KEY_VIEW;
    }
  });

  it("refuses when the key does not exist on the account", async () => {
    mockAccessKeyView = null;
    try {
      const { customFetchImpl } = await setup();
      const cookie = await verifyWithCookie(customFetchImpl);

      const res = await fundWithCookie(customFetchImpl, cookie, {
        accountId: MOCK_ACCOUNT_ID,
        publicKey: MOCK_PUBLIC_KEY,
      });
      expect(res.status).toBe(404);
    } finally {
      mockAccessKeyView = GAS_KEY_VIEW;
    }
  });

  it("enforces the per-user lifetime cap", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);
    const fundBody = { accountId: MOCK_ACCOUNT_ID, publicKey: MOCK_PUBLIC_KEY };

    for (let i = 0; i < 4; i++) {
      const res = await fundWithCookie(customFetchImpl, cookie, fundBody);
      expect(res.status).toBe(200);
    }

    const res = await fundWithCookie(customFetchImpl, cookie, fundBody);
    expect(res.status).toBe(403);
  });

  it("shares the per-user cap across a second device's key", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);
    const SECOND_DEVICE_KEY =
      "ed25519:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

    for (let i = 0; i < 3; i++) {
      const res = await fundWithCookie(customFetchImpl, cookie, {
        accountId: MOCK_ACCOUNT_ID,
        publicKey: MOCK_PUBLIC_KEY,
      });
      expect(res.status).toBe(200);
    }
    const fourth = await fundWithCookie(customFetchImpl, cookie, {
      accountId: MOCK_ACCOUNT_ID,
      publicKey: SECOND_DEVICE_KEY,
    });
    expect(fourth.status).toBe(200);

    const res = await fundWithCookie(customFetchImpl, cookie, {
      accountId: MOCK_ACCOUNT_ID,
      publicKey: SECOND_DEVICE_KEY,
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toMatch(/funding cap exceeded/);
  });

  it("info returns balance, lanes, and remaining cap at finality", async () => {
    const { customFetchImpl } = await setup();
    const cookie = await verifyWithCookie(customFetchImpl);

    const res = await customFetchImpl("http://localhost/api/auth/near/gas-key/info", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ accountId: MOCK_ACCOUNT_ID, publicKey: MOCK_PUBLIC_KEY }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance).toBe("1000000000000000000000");
    expect(body.numNonces).toBe(4);
    expect(body.receiverId).toBe("dev.allthethings.testnet");
    expect(body.capRemaining).toBe("200000000000000000000000");
  });
});
