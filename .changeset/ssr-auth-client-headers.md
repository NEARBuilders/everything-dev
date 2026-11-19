---
"everything-dev": patch
---

Forward the SSR request's headers into the request-scoped auth client (#896). The router context now carries `headers`, and the fallback `createAuthClient` calls in `createRouter` and `getRouteHead` forward it — previously only `renderToStream`'s eager client got the request headers, so auth-client calls made from `getRouteHead` or any router built without an injected `authClient` fetched unauthenticated and 401'd.
