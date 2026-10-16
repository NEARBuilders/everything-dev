export const DEFAULT_DEVICE_LINK_CLIENT_ID = "everything-dev";

/**
 * The CLI device-flow client id recorded by the auth plugin's device-link
 * hook (plugins/auth/src/device-link.ts) and sent by everything-dev's
 * device-login — one constant because the two packages share this module
 * and must not diverge.
 */
export const BOS_CLI_CLIENT_ID = "bos-cli";

export const PASSKEY_WALLET_UNAVAILABLE = "PASSKEY_WALLET_UNAVAILABLE";
