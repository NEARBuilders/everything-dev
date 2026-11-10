---
"every-plugin": minor
"everything-dev": patch
---

Strip `createRpcClient` to a bare typed oRPC client: `createRpcClient(hostUrl, path = "/api/rpc")`. The wrapper's transport opinions (429 retry, connection-error toast, `credentials: "include"`, SSR header merging, browser memoization) move into the UI seam (`everything-dev` `ui/api.ts` `createApiClient`/`createPluginApiClient`), where they already belonged — server consumers now get a plain Promise-native client with no hidden globals. Transport customization (headers, timeouts, retries, test doubles) is `RPCLink`'s native surface; Effect callers lift calls with `Effect.tryPromise` and own timeout/retry/cache in their service layer.
