---
"ui": patch
---

Fix React error #310 ("Rendered more hooks than during the previous render") on first render by adding `defaultErrorComponent`, `defaultNotFoundComponent`, and `defaultPendingComponent` to the client router factory (`router.tsx`). The SSR router (`router.server.tsx`) already set these, but the client router did not, causing TanStack Router's `Match` component to resolve `ResolvedSuspenseBoundary` to `React.Suspense` on the server and `SafeFragment` on the client. This component-type mismatch at the same tree position during hydration forced React into a recovery path that triggered the hooks error.
