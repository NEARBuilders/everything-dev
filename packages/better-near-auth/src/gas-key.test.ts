import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { siwnClient } from "./client.js";
import { gasKeyState, isGasKeyWallet, nextLane } from "./gas-key-client.js";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
afterAll(() => {
  if (previousWindow) {
    Object.defineProperty(globalThis, "window", previousWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

const MOCK_RECIPIENT = "example.near";

const state = vi.hoisted(() => {
  const MOCK_GENERATED_PUBLIC_KEY = "ed25519:11111111111111111111111111111111";
  const MOCK_GENERATED_SECRET_KEY =
    "ed25519:1111111111111111111111111111111111111111111111111111111111111111";
  return {
    mockGeneratedPublicKey: MOCK_GENERATED_PUBLIC_KEY,
    mockGeneratedSecretKey: MOCK_GENERATED_SECRET_KEY,
    walletFeatures: { gasKeys: true } as Record<string, boolean> | undefined,
    signAndSendTransaction: vi.fn(() =>
      Promise.resolve({ transaction: { hash: "bootstrap-tx-hash" } }),
    ),
    builder: {
      signWith: vi.fn().mockReturnThis(),
      useGasKey: vi.fn().mockReturnThis(),
      functionCall: vi.fn().mockReturnThis(),
      send: vi.fn(() => Promise.resolve({ transaction: { hash: "gas-key-tx-hash" } })),
    },
    storedKey: {
      privateKey: MOCK_GENERATED_SECRET_KEY,
      publicKey: MOCK_GENERATED_PUBLIC_KEY,
    } as { privateKey: string; publicKey: string } | null,
  };
});
const MOCK_GENERATED_PUBLIC_KEY = state.mockGeneratedPublicKey;
const MOCK_GENERATED_SECRET_KEY = state.mockGeneratedSecretKey;

vi.mock("near-kit", () => ({
  Near: vi.fn(function NearMock() {
    return {
      transaction: vi.fn(() => state.builder),
    };
  }),
  generateKey: vi.fn(() => ({
    publicKey: { data: new Uint8Array(32).fill(1), toString: () => MOCK_GENERATED_PUBLIC_KEY },
    secretKey: MOCK_GENERATED_SECRET_KEY,
  })),
  generateNonce: vi.fn(() => new Uint8Array(32)),
  fromNearConnect: vi.fn(() => ({})),
  parseGas: (gas: string) => {
    const tgasMatch = /^([0-9.]+) Tgas$/.exec(gas);
    if (tgasMatch) return String(Math.floor(Number(tgasMatch[1]) * 1e12));
    if (/^\d+$/.test(gas)) return gas;
    throw new Error(`Invalid gas: ${gas}`);
  },
  parseKey: vi.fn(() => ({
    publicKey: { data: new Uint8Array(32).fill(1), toString: () => MOCK_GENERATED_PUBLIC_KEY },
    secretKey: MOCK_GENERATED_SECRET_KEY,
  })),
  InMemoryKeyStore: vi.fn(),
}));

vi.mock("@fastnear/near-connect", () => ({
  NearConnector: vi.fn().mockImplementation(function (
    this: unknown,
    { network }: { network: string },
  ) {
    return {
      network,
      registerWallet: vi.fn(() => Promise.resolve()),
      connect: vi.fn(() => Promise.resolve({})),
      disconnect: vi.fn(() => Promise.resolve()),
      getConnectedWallet: vi.fn(() =>
        Promise.resolve({
          wallet: {
            manifest: { features: state.walletFeatures },
            signAndSendTransaction: state.signAndSendTransaction,
          },
          accounts: [{ accountId: "test.testnet", publicKey: "ed25519:wallet" }],
        }),
      ),
      on: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      wallet: vi.fn(() => Promise.resolve({})),
    };
  }),
}));

vi.mock("./gas-key-store.js", () => ({
  saveSessionGasKey: vi.fn(() => Promise.resolve()),
  loadSessionGasKey: vi.fn(() => Promise.resolve(state.storedKey)),
  deleteSessionGasKey: vi.fn(() => Promise.resolve()),
}));

function makeSessionStore(initial: unknown) {
  const { atom } = require("nanostores") as typeof import("nanostores");
  const sessionAtom = atom(initial);
  return {
    sessionAtom,
    store: {
      atoms: { session: sessionAtom },
      notify: vi.fn(),
      listen: vi.fn(),
    },
  };
}

function setupClient(initial: unknown, fetchRoutes: Record<string, unknown> = {}) {
  const plugin = siwnClient({ recipient: MOCK_RECIPIENT });
  const { store, sessionAtom } = makeSessionStore(initial);
  const $fetch = vi.fn(async (path: string, opts?: { method?: string }) => {
    return { data: fetchRoutes[`${opts?.method ?? "GET"} ${path}`] ?? null, error: null };
  }) as unknown as Parameters<typeof plugin.getActions>[0];
  const actions = plugin.getActions(
    $fetch,
    store as unknown as Parameters<typeof plugin.getActions>[1],
    undefined,
  );
  return { actions, sessionAtom, plugin, $fetch };
}

async function setActiveNetworkTestnet(actions: ReturnType<typeof setupClient>["actions"]) {
  await actions.near.setNetwork("testnet");
}

function setSignedIn(plugin: ReturnType<typeof setupClient>["plugin"], accountId = "test.testnet") {
  const atoms = plugin.getAtoms(undefined as never);
  atoms.nearState.set({ accountId, publicKey: null, networkId: "testnet" });
  atoms.walletConnected.set(true);
}

describe("isGasKeyWallet", () => {
  it("accepts only an explicit true on the wallet manifest features", () => {
    expect(isGasKeyWallet({ gasKeys: true })).toBe(true);
    expect(isGasKeyWallet({})).toBe(false);
    expect(isGasKeyWallet({ gasKeys: false })).toBe(false);
    expect(isGasKeyWallet(undefined)).toBe(false);
    expect(isGasKeyWallet(null)).toBe(false);
  });
});

describe("nextLane", () => {
  it("round-robins lanes within the nonce slot count", () => {
    expect(nextLane("testnet", "lanes.near", 2)).toBe(0);
    expect(nextLane("testnet", "lanes.near", 2)).toBe(1);
    expect(nextLane("testnet", "lanes.near", 2)).toBe(0);
    expect(nextLane("mainnet", "lanes.near", 4)).toBe(0);
  });
});

describe("addSessionGasKey", () => {
  beforeEach(() => {
    state.walletFeatures = { gasKeys: true };
    state.storedKey = {
      privateKey: MOCK_GENERATED_SECRET_KEY,
      publicKey: MOCK_GENERATED_PUBLIC_KEY,
    };
    gasKeyState.set(null);
    state.signAndSendTransaction.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("bootstraps a scoped gas key via the wallet and stores it", async () => {
    const { actions, plugin } = setupClient(null, {
      "GET /near/gas-key/scope": {
        enabled: true,
        receiverId: "dev.allthethings.testnet",
        methodNames: ["__fastdata_kv"],
        numNonces: 4,
      },
    });
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);

    await actions.near.addSessionGasKey();

    expect(state.signAndSendTransaction).toHaveBeenCalledTimes(1);
    const params = state.signAndSendTransaction.mock.calls[0]![0];
    expect(params.receiverId).toBe("test.testnet");
    expect(params.actions[0].type).toBe("AddKey");
    expect(params.actions[0].params.publicKey).toBe(MOCK_GENERATED_PUBLIC_KEY);
    expect(params.actions[0].params.accessKey.permission).toEqual({
      receiverId: "dev.allthethings.testnet",
      methodNames: ["__fastdata_kv"],
    });
    expect(params.actions[0].params.gasKeyInfo).toEqual({ balance: "0", numNonces: 4 });

    const atoms = plugin.getAtoms(undefined as never);
    expect(atoms.gasKeyState.get()).toMatchObject({
      accountId: "test.testnet",
      publicKey: MOCK_GENERATED_PUBLIC_KEY,
      networkId: "testnet",
      numNonces: 4,
    });
  });

  it("refuses wallets without the gasKeys feature flag", async () => {
    const { actions, plugin } = setupClient(null, {
      "GET /near/gas-key/scope": {
        enabled: true,
        receiverId: "dev.allthethings.testnet",
      },
    });
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);
    state.walletFeatures = { gasKeys: false };

    await expect(actions.near.addSessionGasKey()).rejects.toThrow(/does not support gas keys/);
    expect(state.signAndSendTransaction).not.toHaveBeenCalled();
    expect(gasKeyState.get()).toBeNull();
  });
});

describe("ensureGasKeyFunded", () => {
  beforeEach(() => {
    state.walletFeatures = { gasKeys: true };
    state.storedKey = {
      privateKey: MOCK_GENERATED_SECRET_KEY,
      publicKey: MOCK_GENERATED_PUBLIC_KEY,
    };
    gasKeyState.set(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("funds when the balance is below the top-up threshold", async () => {
    const { actions, $fetch, plugin } = setupClient(null, {
      "GET /near/gas-key/scope": {
        enabled: true,
        receiverId: "dev.allthethings.testnet",
        topUpThresholdYocto: "10000000000000000000000",
        fundAmountYocto: "50000000000000000000000",
      },
      "POST /near/gas-key/info": { balance: "1000000000000000000000", numNonces: 4 },
      "POST /near/gas-key/fund": {
        txHash: "fund-tx",
        amountFunded: "50000000000000000000000",
      },
    });
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);

    const funded = await actions.near.ensureGasKeyFunded();

    expect(funded).toBe(true);
    const fundCalls = $fetch.mock.calls.filter(
      ([path]: unknown[]) => path === "/near/gas-key/fund",
    );
    expect(fundCalls).toHaveLength(1);
    expect(gasKeyState.get()).toMatchObject({ balance: "1000000000000000000000" });
  });

  it("skips funding when the balance is above the threshold", async () => {
    const { actions, $fetch, plugin } = setupClient(null, {
      "GET /near/gas-key/scope": {
        enabled: true,
        receiverId: "dev.allthethings.testnet",
        topUpThresholdYocto: "10000000000000000000000",
      },
      "POST /near/gas-key/info": { balance: "90000000000000000000000", numNonces: 4 },
    });
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);

    const funded = await actions.near.ensureGasKeyFunded();

    expect(funded).toBe(true);
    const fundCalls = $fetch.mock.calls.filter(
      ([path]: unknown[]) => path === "/near/gas-key/fund",
    );
    expect(fundCalls).toHaveLength(0);
  });

  it("returns false and reports when no key is stored", async () => {
    state.storedKey = null;
    gasKeyState.set(null);
    const { actions, plugin } = setupClient(null, {});
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);

    const funded = await actions.near.ensureGasKeyFunded();
    expect(funded).toBe(false);
  });
});

describe("sendWithGasKey", () => {
  beforeEach(() => {
    state.walletFeatures = { gasKeys: true };
    state.storedKey = {
      privateKey: MOCK_GENERATED_SECRET_KEY,
      publicKey: MOCK_GENERATED_PUBLIC_KEY,
    };
    gasKeyState.set({
      accountId: "test.testnet",
      publicKey: MOCK_GENERATED_PUBLIC_KEY,
      networkId: "testnet",
      balance: "50000000000000000000000",
      numNonces: 2,
    });
    state.builder.signWith.mockClear();
    state.builder.useGasKey.mockClear();
    state.builder.functionCall.mockClear();
    state.builder.useGasKey.mockReturnValue(state.builder);
    state.builder.signWith.mockReturnValue(state.builder);
    state.builder.functionCall.mockReturnValue(state.builder);
  });

  it("signs locally on rotating lanes with a wallet-less client", async () => {
    const { actions, plugin } = setupClient(null, {});
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);

    const first = await actions.near.sendWithGasKey({
      receiverId: "dev.allthethings.testnet",
      methodName: "__fastdata_kv",
    });
    const second = await actions.near.sendWithGasKey({
      receiverId: "dev.allthethings.testnet",
      methodName: "__fastdata_kv",
    });

    expect(first.txHash).toBe("gas-key-tx-hash");
    expect(second.txHash).toBe("gas-key-tx-hash");
    expect(state.builder.signWith).toHaveBeenCalledWith(MOCK_GENERATED_SECRET_KEY);
    expect(state.builder.useGasKey.mock.calls.map(([lane]) => lane)).toEqual([0, 1]);
    expect(state.builder.functionCall).toHaveBeenCalledWith(
      "dev.allthethings.testnet",
      "__fastdata_kv",
      {},
      { gas: "30 Tgas" },
    );
  });

  it("normalizes prepared yocto-gas and Tgas strings through parseGas", async () => {
    const { actions, plugin } = setupClient(null, {});
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);
    const first = await actions.near.sendWithGasKey({
      receiverId: "dev.allthethings.testnet",
      methodName: "__fastdata_kv",
      gas: "10000000000000",
    });
    const second = await actions.near.sendWithGasKey({
      receiverId: "dev.allthethings.testnet",
      methodName: "__fastdata_kv",
      gas: "10 Tgas",
    });
    expect(first.txHash).toBe("gas-key-tx-hash");
    expect(second.txHash).toBe("gas-key-tx-hash");
    expect(state.builder.functionCall.mock.calls.map(([, , , options]) => options.gas)).toEqual([
      "10000000000000",
      "10000000000000",
    ]);
  });

  it("refuses when no key is stored for the account", async () => {
    state.storedKey = null;
    gasKeyState.set(null);
    const { actions, plugin } = setupClient(null, {});
    await setActiveNetworkTestnet(actions);
    setSignedIn(plugin);

    await expect(
      actions.near.sendWithGasKey({
        receiverId: "dev.allthethings.testnet",
        methodName: "__fastdata_kv",
      }),
    ).rejects.toThrow(/No session gas key/);
  });
});
