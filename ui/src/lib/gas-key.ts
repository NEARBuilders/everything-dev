import type { GasKeyState } from "better-near-auth/react";

type GasKeyNearActions = {
  refreshGasKeyInfo: () => Promise<GasKeyState>;
  sendWithGasKey: (params: {
    receiverId: string;
    methodName: string;
    args?: object | Uint8Array;
    gas?: string;
  }) => Promise<{ txHash: string }>;
};

export type PreparedWrite = {
  contractId: string;
  methodName: string;
  args: object | Uint8Array;
  gas: string;
};

export function hasFundedGasKey(state: GasKeyState): boolean {
  return !!(state?.balance && /^\d+$/.test(state.balance) && BigInt(state.balance) > 0n);
}

export async function refreshFundedGasKey(auth: {
  near: Pick<GasKeyNearActions, "refreshGasKeyInfo">;
}): Promise<GasKeyState> {
  try {
    return await auth.near.refreshGasKeyInfo();
  } catch {
    return null;
  }
}

export async function trySendWithGasKey(
  auth: { near: GasKeyNearActions },
  prepared: PreparedWrite,
): Promise<{ txHash: string } | null> {
  const gasState = await refreshFundedGasKey(auth);
  if (!hasFundedGasKey(gasState)) return null;
  try {
    return await auth.near.sendWithGasKey({
      receiverId: prepared.contractId,
      methodName: prepared.methodName,
      args: prepared.args,
      gas: prepared.gas,
    });
  } catch {
    return null;
  }
}
