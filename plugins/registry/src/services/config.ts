import { Context, Layer } from "effect";
import {
  type RegistryClientShape,
  registryClientShape,
  registryNamespaceForNetwork,
} from "everything-dev/registry";

export type NetworkId = "mainnet" | "testnet";

/**
 * The plugin's configuration — the namespace override and the relay
 * credentials. There is no transport here: reads flow through the
 * primitive's client (`everything-dev/registry`), pre-bound to the
 * namespace override by {@link bindRegistryClient}.
 */
export interface RegistryConfig {
  namespace: string;
  relayAccountId?: string;
  relayPrivateKey?: string;
  relayNetwork?: NetworkId;
}

export const DEFAULT_REGISTRY_NAMESPACE = registryNamespaceForNetwork("mainnet");

export class RegistryConfigService extends Context.Service<RegistryConfigService, RegistryConfig>()(
  "registry/RegistryConfigService",
) {
  static Live = (config: {
    namespace?: string;
    relayAccountId?: string;
    relayPrivateKey?: string;
    relayNetwork?: NetworkId;
  }) =>
    Layer.succeed(RegistryConfigService, {
      namespace: config.namespace ?? DEFAULT_REGISTRY_NAMESPACE,
      relayAccountId: config.relayAccountId,
      relayPrivateKey: config.relayPrivateKey,
      relayNetwork: config.relayNetwork,
    });
}

/**
 * The plugin's client binding: the primitive's client shape with the
 * namespace override applied to every call — the plugin never builds a
 * registry URL and never reads without the override.
 */
export function bindRegistryClient(
  namespace: string,
  shape: RegistryClientShape = registryClientShape,
): RegistryClientShape {
  const opts = { registry: namespace };
  return {
    read: (key, readOpts) => shape.read(key, { ...opts, ...readOpts }),
    readOrNull: (key, readOpts) => shape.readOrNull(key, { ...opts, ...readOpts }),
    list: (input, listOpts) => shape.list(input, { ...opts, ...listOpts }),
    history: (key, limit, readOpts) => shape.history(key, limit, { ...opts, ...readOpts }),
  };
}
