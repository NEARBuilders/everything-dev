import type { WritableAtom } from "nanostores";
import { useSyncExternalStore } from "react";
import {
  type GasKeyState,
  getNearAtoms,
  type NearAtomsSource,
  type NearNetwork,
  type NearState,
  readSessionNearAccountId,
} from "./store.js";

export {
  type GasKeyState,
  getNearAtoms,
  type NearAtomsSource,
  type NearClientAtoms,
  type NearNetwork,
  type NearState,
  readSessionNearAccountId,
} from "./store.js";

export type NearConnection = {
  accountId: string | null;
  publicKey: string | null;
  networkId: string;
  walletConnected: boolean;
};

type SessionAtom = WritableAtom<unknown>;

const noopSubscribe = () => () => {};

function useAtomValue<T>(atom: WritableAtom<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => atom.subscribe(onStoreChange),
    () => atom.get(),
    () => atom.get(),
  );
}

function useSessionAccountId(client: NearAtomsSource): string | null {
  const sessionAtom = client.$store?.atoms?.session as SessionAtom | undefined;
  return useSyncExternalStore(
    sessionAtom ? (onStoreChange) => sessionAtom.subscribe(onStoreChange) : noopSubscribe,
    () => readSessionNearAccountId(sessionAtom?.get()),
    () => null,
  );
}

export function useNearState(client: NearAtomsSource): NearState {
  return useAtomValue(getNearAtoms(client).nearState);
}

export function useWalletConnected(client: NearAtomsSource): boolean {
  return useAtomValue(getNearAtoms(client).walletConnected);
}

export function useActiveNetwork(client: NearAtomsSource): NearNetwork {
  return useAtomValue(getNearAtoms(client).activeNetwork);
}

export function useNearAccountId(client: NearAtomsSource): string | null {
  const state = useNearState(client);
  const linkedAccountId = useSessionAccountId(client);
  return state?.accountId ?? linkedAccountId;
}

export function useGasKeyState(client: NearAtomsSource): GasKeyState {
  return useAtomValue(getNearAtoms(client).gasKeyState);
}

export function useNearConnection(client: NearAtomsSource): NearConnection {
  const { nearState, walletConnected, activeNetwork } = getNearAtoms(client);
  const state = useAtomValue(nearState);
  const connected = useAtomValue(walletConnected);
  const network = useAtomValue(activeNetwork);
  const linkedAccountId = useSessionAccountId(client);
  return {
    accountId: state?.accountId ?? linkedAccountId,
    publicKey: state?.publicKey ?? null,
    networkId: state?.networkId ?? network,
    walletConnected: connected,
  };
}
