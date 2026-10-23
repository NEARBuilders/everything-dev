/**
 * Secrets-vault delivery surface (plan 055 ticket 09). The name rules are the
 * single source of truth — the api shell's store, the CLI, and the delivery
 * helper all enforce the same contract: an operator secret must never collide
 * with the keys the platform composes into `identityEnv` (runtime identity,
 * service port, reconciler-provisioned database URLs).
 */
import type { RuntimeDescriptor } from "./adapter";

export const RESERVED_SECRET_NAMES: ReadonlySet<string> = new Set([
  "PORT",
  "API_DATABASE_URL",
  "AUTH_DATABASE_URL",
]);
export const RESERVED_SECRET_PREFIX = "BOS_";
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function isReservedSecretName(name: string): boolean {
  return RESERVED_SECRET_NAMES.has(name) || name.startsWith(RESERVED_SECRET_PREFIX);
}

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name) && !isReservedSecretName(name);
}

/** The runtime identity a descriptor carries in its `identityEnv`. */
export function descriptorRuntime(descriptor: RuntimeDescriptor): {
  account?: string;
  gateway?: string;
} {
  return {
    account: descriptor.identityEnv.BOS_ACCOUNT,
    gateway: descriptor.identityEnv.BOS_GATEWAY,
  };
}

/**
 * Merge resolved stored secrets into a descriptor's `identityEnv`. The
 * descriptor's own keys always win — stored values can never shadow the
 * platform-composed identity.
 */
export function withSecrets(
  descriptor: RuntimeDescriptor,
  stored: Record<string, string>,
): RuntimeDescriptor {
  return { ...descriptor, identityEnv: { ...stored, ...descriptor.identityEnv } };
}
