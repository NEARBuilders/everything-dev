import { useRouteContext } from "@tanstack/react-router";
import type { PasskeyWalletNetwork } from "better-near-auth/client";

export function useNetworkId(): PasskeyWalletNetwork {
  const { runtimeConfig } = useRouteContext({ strict: false });
  return (runtimeConfig?.networkId ?? "mainnet") as PasskeyWalletNetwork;
}
