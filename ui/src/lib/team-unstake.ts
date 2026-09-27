import {
  describeDaoError,
  signAsDaoTransaction,
  type UseDaoConnectionResult,
  verifyDaoAccount,
} from "@/lib/dao-connect";
import { parseNearAmount } from "@/lib/near-amount";

const YOCTO_PER_NEAR = 10n ** 24n;

export interface PoolCall {
  receiverId: string;
  methodName: "unstake" | "withdraw";
  args: { amount: string };
  gas: string;
}

export function teamPoolCall(
  poolAccountId: string,
  methodName: "unstake" | "withdraw",
  amountYocto: bigint,
): PoolCall {
  return {
    receiverId: poolAccountId,
    methodName,
    args: { amount: amountYocto.toString() },
    gas: "125 Tgas",
  };
}

export function yoctoToNearInput(yocto: bigint) {
  const whole = yocto / YOCTO_PER_NEAR;
  const fraction = (yocto % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function parseUnstakeAmount(amount: string, max: bigint) {
  const yocto = parseNearAmount(amount);
  if (!yocto || yocto > max) return null;
  return yocto;
}

export async function proposeTeamPoolAction(input: {
  teamAccountId: string;
  poolAccountId: string;
  method: "unstake" | "withdraw";
  amountYocto: bigint;
  maxAmountYocto: bigint;
  authAccountId: string | null;
  connection: Pick<UseDaoConnectionResult, "daoAccountId" | "connect" | "disconnect">;
}) {
  if (input.amountYocto <= 0n || input.amountYocto > input.maxAmountYocto) {
    throw new Error(`Enter an amount within the available team ${input.method} balance.`);
  }
  try {
    let dao = input.connection.daoAccountId;
    if (dao !== input.teamAccountId || !(await verifyDaoAccount(input.teamAccountId))) {
      if (dao) await input.connection.disconnect();
      dao = await input.connection.connect({
        authAccountId: input.authAccountId ?? undefined,
      });
    }
    if (dao !== input.teamAccountId) {
      throw new Error(
        `Trezu connected ${dao}, but this ${input.method} must be signed by ${input.teamAccountId}`,
      );
    }
    await signAsDaoTransaction(
      input.teamAccountId,
      teamPoolCall(input.poolAccountId, input.method, input.amountYocto),
    );
  } catch (error) {
    throw new Error(describeDaoError(error, input.teamAccountId));
  }
}
