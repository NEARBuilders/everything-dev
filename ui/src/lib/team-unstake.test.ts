import { describe, expect, it, vi } from "vitest";
import {
  maxMinusOneNear,
  parseUnstakeAmount,
  proposeTeamPoolAction,
  teamPoolCall,
  yoctoToNearInput,
} from "./team-unstake";

const staked = 2_500_000_000_000_000_000_000_000n;

describe("maxMinusOneNear", () => {
  it("leaves a 1 NEAR margin below the max", () => {
    expect(maxMinusOneNear(staked)).toBe(staked - 10n ** 24n);
    expect(maxMinusOneNear(10n ** 24n + 1n)).toBe(1n);
  });

  it("keeps the full max when the balance is at most 1 NEAR", () => {
    expect(maxMinusOneNear(10n ** 24n)).toBe(10n ** 24n);
    expect(maxMinusOneNear(1n)).toBe(1n);
    expect(maxMinusOneNear(0n)).toBe(0n);
  });
});

vi.mock("@/lib/dao-connect", () => ({
  verifyDaoAccount: vi.fn(),
  signAsDaoTransaction: vi.fn(),
  describeDaoError: (error: unknown, want: string) =>
    error instanceof Error ? `${error.message} (${want})` : `${String(error)} (${want})`,
}));

import { signAsDaoTransaction, verifyDaoAccount } from "@/lib/dao-connect";

describe("team pool action proposal", () => {
  it("builds pool unstake and withdraw calls without an attached deposit", () => {
    expect(teamPoolCall("city-node-4.pool.near", "unstake", staked)).toEqual({
      receiverId: "city-node-4.pool.near",
      methodName: "unstake",
      args: { amount: "2500000000000000000000000" },
      gas: "125 Tgas",
    });
    expect(teamPoolCall("city-node-4.pool.near", "withdraw", staked)).toEqual({
      receiverId: "city-node-4.pool.near",
      methodName: "withdraw",
      args: { amount: "2500000000000000000000000" },
      gas: "125 Tgas",
    });
    expect("attachedDeposit" in teamPoolCall("city-node-4.pool.near", "unstake", staked)).toBe(
      false,
    );
    expect(yoctoToNearInput(staked)).toBe("2.5");
    expect(parseUnstakeAmount("2.5", staked)).toBe(staked);
    expect(parseUnstakeAmount("3", staked)).toBeNull();
    expect(parseUnstakeAmount("0", staked)).toBeNull();
  });

  it("connects Trezu as the team treasury and proposes the unstake call", async () => {
    vi.mocked(verifyDaoAccount).mockResolvedValue(false);
    vi.mocked(signAsDaoTransaction).mockResolvedValue({} as never);
    const connection = {
      daoAccountId: "other.sputnik-dao.near",
      connect: vi.fn().mockResolvedValue("india.sputnik-dao.near"),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    await proposeTeamPoolAction({
      teamAccountId: "india.sputnik-dao.near",
      poolAccountId: "city-node-4.pool.near",
      method: "unstake",
      amountYocto: 1_000_000_000_000_000_000_000_000n,
      maxAmountYocto: staked,
      authAccountId: "itexpert120-contra.near",
      connection,
    });
    expect(connection.disconnect).toHaveBeenCalled();
    expect(connection.connect).toHaveBeenCalledWith({
      authAccountId: "itexpert120-contra.near",
    });
    expect(signAsDaoTransaction).toHaveBeenCalledWith(
      "india.sputnik-dao.near",
      teamPoolCall("city-node-4.pool.near", "unstake", 1_000_000_000_000_000_000_000_000n),
    );
  });

  it("proposes the withdraw call against the unstaked balance", async () => {
    vi.mocked(verifyDaoAccount).mockResolvedValue(true);
    vi.mocked(signAsDaoTransaction).mockResolvedValue({} as never);
    const unstaked = 1_500_000_000_000_000_000_000_000n;
    const connection = {
      daoAccountId: "india.sputnik-dao.near",
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    await proposeTeamPoolAction({
      teamAccountId: "india.sputnik-dao.near",
      poolAccountId: "city-node-4.pool.near",
      method: "withdraw",
      amountYocto: unstaked,
      maxAmountYocto: unstaked,
      authAccountId: null,
      connection,
    });
    expect(connection.connect).not.toHaveBeenCalled();
    expect(signAsDaoTransaction).toHaveBeenCalledWith(
      "india.sputnik-dao.near",
      teamPoolCall("city-node-4.pool.near", "withdraw", unstaked),
    );
  });
});
