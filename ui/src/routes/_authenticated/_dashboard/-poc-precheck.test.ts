import { Near } from "near-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrecheckPlan } from "./-poc-precheck";
import type { StationState, StepState } from "./-poc-stations";

const LOCKUP = "9de493a8321d3f276189ca1aaae4351eee9eda8b.venear.dao";

function stubChain(knownDeposited: string, balance: string | null) {
  vi.spyOn(Near.prototype, "view").mockImplementation((_contractId, method) => {
    if (method === "get_known_deposited_balance") return Promise.resolve(knownDeposited);
    if (method === "get_owner_account_id") return Promise.resolve(LOCKUP);
    if (method === "get_staking_pool_account_id") return Promise.resolve(null);
    return Promise.resolve("0");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        balance
          ? new Response(JSON.stringify({ result: { amount: balance } }))
          : new Response("{}", { status: 500 }),
      ),
    ),
  );
}

function stakeStep(amountYocto: string): StepState {
  return {
    id: "stake-endowment",
    label: "stake from the lockup",
    status: "pending",
    pendingProposal: null,
    plan: {
      kind: "call",
      receiverId: LOCKUP,
      methodName: "deposit_and_stake",
      args: { amount: amountYocto },
      gas: "125 Tgas",
      attachedDeposit: "1",
    },
  };
}

const station = { def: { signer: "endowment" } } as unknown as StationState;

function createPrecheck() {
  return createPrecheckPlan({
    pool: "city-node-3.pool.near",
    teamLockup: "",
    endowmentLockup: LOCKUP,
    accountFor: () => "chicagonode.sputnik-dao.near",
    log: vi.fn(),
    fetchPublishedNow: async () => null,
    fetchTeamPoolAccount: async () => null,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stake-endowment precheck", () => {
  it("throws before staging when the amount exceeds the lockup's available balance", async () => {
    // balance 3 NEAR − 2 NEAR storage reserve = 1 NEAR available
    stubChain("0", "3000000000000000000000000");
    const precheck = createPrecheck();
    await expect(precheck(station, stakeStep("5000000000000000000000000"))).rejects.toThrow(
      /can stake at most 1\.0000 NEAR/,
    );
  });

  it("narrows the stake to the remaining amount within the available balance", async () => {
    stubChain("1000000000000000000000000", "300002000000000000000000000002");
    const precheck = createPrecheck();
    const plan = await precheck(station, stakeStep("5000000000000000000000000"));
    expect(plan).toMatchObject({
      kind: "call",
      methodName: "deposit_and_stake",
      args: { amount: "4000000000000000000000000" },
    });
  });

  it("skips the guard when the lockup balance is unreadable", async () => {
    stubChain("0", null);
    const precheck = createPrecheck();
    const plan = await precheck(station, stakeStep("5000000000000000000000000"));
    expect(plan).toMatchObject({ args: { amount: "5000000000000000000000000" } });
  });
});
