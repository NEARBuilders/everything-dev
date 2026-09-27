import type { GasKeyState } from "better-near-auth/react";
import { useGasKeyState } from "better-near-auth/react";
import { useCallback, useEffect } from "react";
import { useAuthClient } from "@/app";
import { hasFundedGasKey } from "./gas-key";

export function useSessionGasKey(): {
  state: GasKeyState;
  isReady: boolean;
  refresh: () => Promise<GasKeyState>;
} {
  const auth = useAuthClient();
  const state = useGasKeyState(auth);

  const refresh = useCallback(async () => {
    try {
      return await auth.near.refreshGasKeyInfo();
    } catch {
      return null;
    }
  }, [auth]);

  const publicKey = state?.publicKey;
  useEffect(() => {
    if (!publicKey) return;
    void refresh();
    void auth.near.ensureGasKeyFunded();
  }, [auth, publicKey, refresh]);

  const isReady = hasFundedGasKey(state);
  return { state, isReady, refresh };
}
