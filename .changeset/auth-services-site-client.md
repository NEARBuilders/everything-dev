---
"everything-dev": minor
---

Auth flows extracted to `services/auth/` (ADR 0031 shape): `DeviceLoginService` (the RFC 8628 device loop), `SessionStore` (the `.bos/session.json` handle), and `SignerService` (the near / delegate / custody signing dispatch, moved out of the deploy train). All CLI→site HTTP now goes through one `SiteClient` whose error parsing understands every payload shape the server emits — including the oRPC envelope (`{ json: { code, message, data } }`), which nothing parsed before, so the server's FORBIDDEN detail ("link the account first") now surfaces verbatim instead of a bare "Deploy key could not be created (403)". The publish-key mint is shared: `login --key`'s export and `bos key generate` run the same `mintPublishKey` (near CLI ensure → namespace resolve → existing-key listing → scoped FCAK add). Behavior-preserving across the login matrix (plain, `--key`, `--custody`, `--env staging`, `--site`).
