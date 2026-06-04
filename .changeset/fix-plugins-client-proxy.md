---
"host": patch
---

Fix `createPluginsClient` to use Proxy composition instead of `Object.assign`, which silently dropped Proxy-resolved RPC methods from the API client