/**
 * The `bos start --config` decision: an explicit local config outranks the
 * registry identity (BOS_ACCOUNT/BOS_GATEWAY) — FastKV is fetched only when
 * no local config was given.
 */

export interface StartConfigSource {
  configPath?: string;
  registry?: { account: string; domain: string };
}

export function resolveStartConfigSource(
  input: { configPath?: string; account?: string; domain?: string },
  env: { BOS_ACCOUNT?: string; BOS_GATEWAY?: string },
): StartConfigSource {
  if (input.configPath) {
    return { configPath: input.configPath };
  }
  const account = input.account ?? env.BOS_ACCOUNT;
  const domain = input.domain ?? env.BOS_GATEWAY;
  if (account && domain) {
    return { registry: { account, domain } };
  }
  return {};
}

/** A registry-fetched start is a real deployment — a localhost origin there is
 * a stray dev leftover. Local starts (explicit --config-path, bare `bos start`)
 * keep the operator's environment: their localhost origin IS the reachable
 * deployment context the in-process host's auth seam reads. */
export function isRegistryStart(source: StartConfigSource): boolean {
  return source.registry !== undefined;
}
