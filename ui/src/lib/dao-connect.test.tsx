// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectDaoAccount,
  disconnectDaoAccount,
  signAsDaoTransaction,
  useDaoAutoRestore,
  useDaoConnectionStore,
} from "./dao-connect";

const harness = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectedWallet: vi.fn(),
  constructorOptions: {} as Record<string, unknown>,
  functionCallArgs: null as unknown,
}));

vi.mock("near-kit", async () => {
  const actual = await vi.importActual<typeof import("near-kit")>("near-kit");
  return {
    ...actual,
    fromNearConnect: (connector: unknown) => ({ connector }),
    Near: class {
      transaction() {
        return {
          functionCall(receiverId: string, methodName: string, args: unknown) {
            harness.functionCallArgs = { receiverId, methodName, args };
            return {
              send: async () => ({ status: "EXECUTED" }),
            };
          },
        };
      }
    },
  };
});

vi.mock("@fastnear/near-connect", async () => {
  const actual =
    await vi.importActual<typeof import("@fastnear/near-connect")>("@fastnear/near-connect");
  return {
    ...actual,
    NearConnector: class {
      constructor(options: Record<string, unknown> = {}) {
        harness.constructorOptions = options;
      }
      async connect(input: { walletId?: string }) {
        return harness.connect(input);
      }
      async disconnect() {
        return harness.disconnect();
      }
      async getConnectedWallet() {
        return harness.getConnectedWallet();
      }
    },
  };
});

function Probe({ authAccountId }: { authAccountId: string | null }) {
  useDaoAutoRestore(authAccountId);
  return null;
}

const AUTH_ACCOUNT_KEY = "dao-connect:auth-account";

describe("trezu session binding to the SIWN account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useDaoConnectionStore.getState().reset();
  });

  afterEach(cleanup);

  it("restores the session when the binding matches the auth account", async () => {
    localStorage.setItem(AUTH_ACCOUNT_KEY, "efiz.near");
    harness.getConnectedWallet.mockResolvedValue({
      accounts: [{ accountId: "dao.sputnik.near" }],
    });

    render(<Probe authAccountId="efiz.near" />);

    await waitFor(() => {
      expect(useDaoConnectionStore.getState()).toMatchObject({
        status: "connected",
        daoAccountId: "dao.sputnik.near",
      });
    });
    expect(harness.disconnect).not.toHaveBeenCalled();
  });

  it("disconnects when the binding belongs to a different auth account", async () => {
    localStorage.setItem(AUTH_ACCOUNT_KEY, "work.efiz.near");
    harness.getConnectedWallet.mockResolvedValue({
      accounts: [{ accountId: "dao.sputnik.near" }],
    });

    render(<Probe authAccountId="efiz.near" />);

    await waitFor(() => expect(harness.disconnect).toHaveBeenCalledOnce());
    expect(useDaoConnectionStore.getState().status).toBe("idle");
    expect(localStorage.getItem(AUTH_ACCOUNT_KEY)).toBeNull();
  });

  it("disconnects when signed out", async () => {
    localStorage.setItem(AUTH_ACCOUNT_KEY, "efiz.near");
    harness.getConnectedWallet.mockResolvedValue({
      accounts: [{ accountId: "dao.sputnik.near" }],
    });

    render(<Probe authAccountId={null} />);

    await waitFor(() => expect(harness.disconnect).toHaveBeenCalledOnce());
    expect(useDaoConnectionStore.getState().status).toBe("idle");
  });

  it("disconnects legacy sessions without a binding", async () => {
    harness.getConnectedWallet.mockResolvedValue({
      accounts: [{ accountId: "dao.sputnik.near" }],
    });

    render(<Probe authAccountId="efiz.near" />);

    await waitFor(() => expect(harness.disconnect).toHaveBeenCalledOnce());
    expect(useDaoConnectionStore.getState().status).toBe("idle");
  });

  it("leaves the store idle when no trezu session exists", async () => {
    harness.getConnectedWallet.mockRejectedValue(new Error("No wallet selected"));

    render(<Probe authAccountId="efiz.near" />);

    await waitFor(() => expect(harness.getConnectedWallet).toHaveBeenCalled());
    expect(harness.disconnect).not.toHaveBeenCalled();
    expect(useDaoConnectionStore.getState().status).toBe("idle");
  });

  it("binds the auth account on connect and always targets the trezu wallet", async () => {
    harness.connect.mockResolvedValue({
      getAccounts: async () => [{ accountId: "dao.sputnik.near" }],
    });

    const accountId = await connectDaoAccount({ authAccountId: "efiz.near" });

    expect(accountId).toBe("dao.sputnik.near");
    expect(harness.connect).toHaveBeenCalledWith({ walletId: "trezu-wallet" });
    expect(localStorage.getItem(AUTH_ACCOUNT_KEY)).toBe("efiz.near");
    expect(useDaoConnectionStore.getState()).toMatchObject({
      status: "connected",
      daoAccountId: "dao.sputnik.near",
    });
  });

  it("clears the binding on disconnect", async () => {
    localStorage.setItem(AUTH_ACCOUNT_KEY, "efiz.near");

    await disconnectDaoAccount();

    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(localStorage.getItem(AUTH_ACCOUNT_KEY)).toBeNull();
    expect(useDaoConnectionStore.getState().status).toBe("idle");
  });
});

describe("csp nonce propagation to the trezu wallet iframe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.constructorOptions = {};
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete window.__CSP_NONCE__;
    vi.resetModules();
  });

  async function importFreshModule() {
    vi.resetModules();
    return import("./dao-connect");
  }

  it("forwards the page nonce to NearConnector under strict CSP", async () => {
    window.__CSP_NONCE__ = "ULNjaTTRHz1rPLxPkj5+8w==";
    harness.connect.mockResolvedValue({
      getAccounts: async () => [{ accountId: "dao.sputnik.near" }],
    });

    const { connectDaoAccount: connectDaoAccountFresh } = await importFreshModule();
    await connectDaoAccountFresh({ authAccountId: "efiz.near" });

    expect(harness.constructorOptions).toMatchObject({
      cspNonce: "ULNjaTTRHz1rPLxPkj5+8w==",
    });
  });

  it("leaves cspNonce undefined when the page has no nonce (relaxed CSP)", async () => {
    harness.connect.mockResolvedValue({
      getAccounts: async () => [{ accountId: "dao.sputnik.near" }],
    });

    const { connectDaoAccount: connectDaoAccountFresh } = await importFreshModule();
    await connectDaoAccountFresh({ authAccountId: "efiz.near" });

    expect(harness.constructorOptions.cspNonce).toBeUndefined();
  });
});

describe("dao transaction args flow through unchanged", () => {
  it("passes non-empty args to the NEAR transaction builder as-is", async () => {
    harness.getConnectedWallet.mockResolvedValue({ accountId: "dao.sputnik.near" });

    await connectDaoAccount({ authAccountId: "efiz.near" });

    const spec = {
      receiverId: "vote.near",
      methodName: "vote",
      args: { proposal_id: 7 },
      gas: "10",
    };

    await signAsDaoTransaction("dao.sputnik.near", spec);

    expect(harness.functionCallArgs).toEqual({
      receiverId: "vote.near",
      methodName: "vote",
      args: { proposal_id: 7 },
    });
  });
});
