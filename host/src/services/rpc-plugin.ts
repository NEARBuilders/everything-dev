import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RuntimePluginConfig } from "everything-dev/types";
import { logger } from "../utils/logger";

/**
 * A call-only plugin attachment (`plugins.<key>.mode: "rpc"`): the host never
 * federation-loads the plugin — it holds a typed oRPC client over the remote's
 * `/api/rpc` and forwards browser traffic (`/api/rpc/{key}/*`) to the same
 * target. The declared secret, when present in the environment, rides as
 * `x-api-key` on both paths and never leaves the server.
 *
 * The client is typed at the CONSUMER (generated `plugins-types.gen.ts`
 * narrows it per contract); at runtime it is the plain oRPC proxy, so
 * `createClient` returns `unknown` and the host treats the entry like any
 * other `HostPluginEntry`.
 */
export interface RpcPluginClient {
  key: string;
  name: string;
  createClient: (context?: unknown) => unknown;
  router: undefined;
  metadata: { remoteUrl: string; version?: string };
  /** routes-layer forward target for `/api/rpc/{key}/*` */
  proxy: { target: string; apiKey?: string };
  /** reachability probe — the remote's plugin manifest, not a bundle artifact */
  probeUrl: string;
  warnings: [];
}

export interface RpcPluginDeps {
  /** transport seam — tests inject a stub; production uses global fetch */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** secret seam — tests inject; production reads the process environment */
  resolveSecret?: (name: string) => string | undefined;
}

const resolveSecretFromEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

export function createRpcPluginClient(
  key: string,
  entry: RuntimePluginConfig,
  deps?: RpcPluginDeps,
): RpcPluginClient {
  const target = entry.url.replace(/\/$/, "");
  const fetchImpl =
    deps?.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const resolveSecret = deps?.resolveSecret ?? resolveSecretFromEnv;

  const apiKey = (entry.secrets ?? [])
    .map((name) => resolveSecret(name))
    .find((value): value is string => value !== undefined);

  if ((entry.secrets?.length ?? 0) > 0 && !apiKey) {
    logger.warn(
      `[RpcPlugins][${key}] declared secret(s) ${entry.secrets?.join(", ")} not set in the environment — rpc calls and proxy forwards go out without x-api-key`,
    );
  }

  const headers: Record<string, string> | undefined = apiKey ? { "x-api-key": apiKey } : undefined;

  const client = createORPCClient(
    new RPCLink({
      origin: target,
      url: "/api/rpc",
      fetch: (fetchUrl, init) =>
        fetchImpl(fetchUrl, {
          ...init,
          headers: headers ? { ...init?.headers, ...headers } : init?.headers,
        }),
    }),
  );

  return {
    key,
    name: entry.name,
    createClient: () => client,
    router: undefined,
    metadata: { remoteUrl: target },
    proxy: { target, ...(apiKey ? { apiKey } : {}) },
    probeUrl: `${target}/plugin.manifest.json`,
    warnings: [],
  };
}
