import { sanitizeUserCode } from "./-user-code";

/**
 * The pairing params every device-link page forwards — dropping any of them
 * on a sign-in roundtrip severs the CLI/wallet pairing.
 */
export type DevicePairingSearch = {
  user_code?: string;
  pubKey?: string;
  contract?: string;
  account?: string;
  network?: string;
  source?: string;
  custody?: string;
};

export function validateDevicePairingSearch(search: Record<string, unknown>): DevicePairingSearch {
  return {
    user_code: sanitizeUserCode(search.user_code),
    pubKey: typeof search.pubKey === "string" ? search.pubKey : undefined,
    contract: typeof search.contract === "string" ? search.contract : undefined,
    account: typeof search.account === "string" ? search.account : undefined,
    network: typeof search.network === "string" ? search.network : undefined,
    source: typeof search.source === "string" ? search.source : undefined,
    custody: search.custody === "1" ? "1" : undefined,
  };
}

export function devicePairingHref(
  router: {
    buildLocation: (location: { to: string; search: DevicePairingSearch }) => { href: string };
  },
  search: DevicePairingSearch,
): string {
  return router.buildLocation({ to: "/login/device", search }).href;
}
