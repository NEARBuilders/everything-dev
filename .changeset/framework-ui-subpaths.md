---
"everything-dev": minor
"ui": minor
---

Framework UI files children receive as byte-identical copies move into the `everything-dev` package as ui subpaths — hydrate (client bootstrap), router-client (client router factory), router-server (SSR router module), entry (web entry runner), and router-error (the generic error boundary). Child copies shrink to thin wiring stubs that inject only the app's generated artifacts (`routeTree.gen`, `routeConfig.gen`, `styles.css`) and join the framework-owned sync set. The framework router/hydrate modules import the package's own api/auth/runtime/manifest surfaces; compose payload digest parity is unchanged (the hydrate suite ports to the package and keeps the digest-mismatch fallback coverage). `RouterContextWithApi` gains the optional `authClient` the routers already threaded. Closes #186.
