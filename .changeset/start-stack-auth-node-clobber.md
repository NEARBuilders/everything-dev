---
"everything-dev": patch
---

Fix the start-command stack mounting auth as a generic plugin: `normalizeToNodes`'s plugins loop overwrote the dedicated `auth` DAG node (kind `"auth"`) with `kind:"plugin"` whenever the runtime config carried the auth mirror — which start/production resolution always does (the mirror's url is filled; in dev it stays empty, so dev was safe only by accident). With the node mistyped, the host never assigned `plugins.auth`/`authClient`, so `/api/auth/*` was never mounted: every better-auth route (anonymous sign-in, get-session, organizations, api keys) returned plain-text 404, and the body-limit/rate-limit regression tests cascaded. The plugins loop now skips the auth mirror — the same rule the host's plugin loading and the service descriptors already apply.
