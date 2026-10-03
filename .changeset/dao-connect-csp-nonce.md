---
"ui": patch
---

Pass the page CSP nonce to the DAO (Trezu) `NearConnector` in `ui/src/lib/dao-connect.ts`. Under strict CSP (`script-src 'nonce-…' 'strict-dynamic'`), the sandboxed wallet iframe's inline `srcdoc` scripts were blocked on `/apply` and the tenant wizard because the singleton DAO connector was created without `cspNonce` — unlike the SIWN login connector, which already receives it via `createAuthClient`. The nonce now flows from `window.__CSP_NONCE__` (via `getCspNonce()` from `@/app`) into `NearConnectorOptions.cspNonce`, matching `@hot-labs/near-connect`'s supported propagation path. No behavior change in relaxed-CSP environments (nonce is `undefined`).
