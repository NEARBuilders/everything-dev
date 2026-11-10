import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { Effect, Redacted } from "effect";
import type { RuntimePluginConfig } from "everything-dev/types";

/**
 * A call-only plugin attachment (`plugins.<key>` authored with `proxy` +
 * `contract`): the host never federation-loads the plugin — it holds a typed
 * oRPC client over the remote's `/api/rpc` and forwards browser traffic
 * (`/api/rpc/{key}/*`) to the same target. The declared secret, when present
 * in the environment, rides as `x-api-key` on both paths and never leaves
 * the server (held redacted end to end; only the outgoing header sees the
 * raw value).
 *
 * The client is typed at the CONSUMER (generated `plugins-types.gen.ts`
 * narrows it per contract); at runtime it is the plain oRPC proxy, so
 * `createClient` returns `unknown` and the host treats the entry like any
 * other `HostPluginEntry`. Construction is lazy and cannot fail — an
 * unreachable target or missing secret surfaces at request time, never at
 * boot.
 */
export interface RpcPluginClient {
  key: string;
  name: string;
  createClient: (context?: unknown) => unknown;
  router: undefined;
  metadata: { remoteUrl: string; version?: string };
  /** routes-layer forward target for `/api/rpc/{key}/*`; the credential is
   * redacted — unredact at the header-set site */
  proxy: { target: string; apiKey?: Redacted.Redacted<string> };
  warnings: [];
}

export interface RpcPluginDeps {
  /** transport seam — tests inject a stub; production uses global fetch */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** secret seam — tests inject; production wires the host's Config-backed
   * resolver (secretsFromEnv). The default reads the process environment. */
  resolveSecret?: (name: string) => Effect.Effect<Redacted.Redacted<string> | undefined>;
}

const resolveSecretFromEnv = (name: string): Effect.Effect<Redacted.Redacted<string> | undefined> =>
  Effect.sync(() => {
    const value = process.env[name];
    return value && value.length > 0 ? Redacted.make(value) : undefined;
  });

export const createRpcPluginClient = Effect.fn("createRpcPluginClient")(function* (
  key: string,
  entry: RuntimePluginConfig,
  deps?: RpcPluginDeps,
): Effect.fn.Return<RpcPluginClient> {
  const target = entry.url.replace(/\/$/, "");
  const fetchImpl =
    deps?.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const resolveSecret = deps?.resolveSecret ?? resolveSecretFromEnv;

  const resolved = yield* Effect.forEach(
    entry.secrets ?? [],
    (name) => resolveSecret(name).pipe(Effect.map((secret) => ({ name, secret }))),
    { concurrency: 1 },
  );
  const apiKey = resolved.find((candidate) => candidate.secret !== undefined)?.secret;

  if ((entry.secrets?.length ?? 0) > 0 && !apiKey) {
    yield* Effect.logWarning(
      `[RpcPlugins][${key}] declared secret(s) ${entry.secrets?.join(", ")} not set in the environment — rpc calls and proxy forwards go out without x-api-key`,
    );
  }

  const client = createORPCClient(
    new RPCLink({
      origin: target,
      url: "/api/rpc",
      fetch: (fetchUrl, init) => {
        const merged = new Headers(init?.headers);
        if (apiKey) merged.set("x-api-key", Redacted.value(apiKey));
        return fetchImpl(fetchUrl, { ...init, headers: merged });
      },
    }),
  );

  return {
    key,
    name: entry.name,
    createClient: () => client,
    router: undefined,
    metadata: { remoteUrl: target },
    proxy: { target, ...(apiKey ? { apiKey } : {}) },
    warnings: [],
  };
});
