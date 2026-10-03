---
"everything-dev": minor
---

SSR loader calls to plugin APIs now carry a per-call deadline (15s, opt-in at the `createPluginsClient` call site and enabled for the SSR render path). A wedged plugin endpoint rejects into the route's error boundary and closes the stream — the page degrades to an error instead of a never-ending suspended stream that hangs browsers and regression suites. The better-auth client surface is deliberately left unwrapped (its client objects carry non-call function-valued members).
