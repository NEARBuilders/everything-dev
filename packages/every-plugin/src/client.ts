import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient, RouterContract } from "@orpc/contract";

/**
 * Bare typed oRPC client over the RPC protocol — a thin convenience over
 * `createORPCClient(new RPCLink({ origin, url }))`.
 *
 * Promise-native, so async/await callers call it directly and Effect callers
 * lift calls with `Effect.tryPromise` (owning timeout/retry/cache in their
 * service layer). Transport customization (headers, timeouts, retries, test
 * doubles) is RPCLink's native surface — construct the link yourself and pass
 * it to `createORPCClient` instead of growing config here.
 */
export function createRpcClient<T extends RouterContract = RouterContract>(
  hostUrl: string,
  path: `/${string}` = "/api/rpc",
): ContractRouterClient<T> {
  return createORPCClient(new RPCLink({ origin: hostUrl, url: path })) as ContractRouterClient<T>;
}
