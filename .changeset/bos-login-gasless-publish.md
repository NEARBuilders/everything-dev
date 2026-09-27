---
"everything-dev": minor
"@everything-dev/auth-plugin": patch
"ui": patch
---

`bos login` — sign in with your NEAR account through the hosted site via the OAuth 2.0 Device Flow (RFC 8628), the same flow the site's QR pairing uses: the CLI requests a device code, you approve at `/login/device` in any browser (same machine or not — it works over SSH and headless), and the CLI mints its credential from the approved session. `--key` exports a scoped FastKV publish key to `~/.near-credentials`; the gasless delegate key is approved in the browser on the same page (wallet signs the `addKey`). `bos logout` revokes the credential. `bos publish --wallet` publishes gaslessly via a NEP-366 delegate action through the platform relayer. New `publish.auth` config surface (`session` | `key` | `custody`). The auth server's device-authorization plugin now serves the flow at `/login/device` (moved from `/device` — nothing had shipped against the old path) and accepts any non-empty `client_id` (public-client device flow — user approval is the trust boundary; the code↔client binding is still enforced at the token endpoint). The site's `/login` now preserves full redirect targets including query strings.
