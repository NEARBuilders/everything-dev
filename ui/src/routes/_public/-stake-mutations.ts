import type { QueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { AuthClient } from "@/app";
import { invalidateStakePoolQueries } from "@/lib/queries/stake-pool";

const STAKE_GAS = "300000000000000";

export type StakeVariables = {
  amount: bigint;
  network: string;
  poolAccountId: string;
  protocol: string;
};

export function useStakeWalletConnection(auth: AuthClient) {
  const [isConnecting, setIsConnecting] = useState(false);
  const connect = async () => {
    setIsConnecting(true);
    try {
      const connected = await auth.near.ensureConnected();
      if (!connected) toast.error("Failed to connect wallet");
    } catch {
      toast.error("Failed to connect wallet");
    } finally {
      setIsConnecting(false);
    }
  };

  return { connect, isConnecting };
}

export function useStakeMutation(auth: AuthClient, queryClient: QueryClient) {
  return useMutation({
    mutationFn: async ({
      amount: stakeAmount,
      network,
      poolAccountId,
      protocol,
    }: StakeVariables) => {
      if (protocol !== "near") {
        throw new Error("Only NEAR validators can receive NEAR stakes.");
      }
      if (stakeAmount <= 0n) {
        throw new Error("Enter a positive stake amount.");
      }
      const connected = await auth.near.ensureConnected();
      if (!connected) throw new Error("Connect a NEAR wallet to stake.");
      if (auth.near.getNetwork() !== network) {
        throw new Error(`Switch your wallet to ${network} before staking.`);
      }
      const signer = auth.near.getAccountId();
      if (!signer) throw new Error("Connect a NEAR wallet to stake.");
      const near = auth.near.getNearClient();
      const result = await near
        .transaction(signer)
        .functionCall(
          poolAccountId,
          "deposit_and_stake",
          {},
          { gas: STAKE_GAS, attachedDeposit: stakeAmount },
        )
        .send({ waitUntil: "FINAL" });
      return { network, poolAccountId, result };
    },
    onSuccess: async ({ network, poolAccountId, result }) => {
      toast.success("Staked", {
        description: result.transaction?.hash ? `tx: ${result.transaction.hash}` : undefined,
      });
      try {
        await invalidateStakePoolQueries(queryClient, poolAccountId, network);
      } catch {
        toast.warning("Stake confirmed, but live pool stats could not refresh.");
      }
    },
    onError: (err: Error) => toast.error(err.message || "Failed to stake"),
  });
}
