---
"everything-dev": patch
---

Security hardening batch (plan 039):

- Plugin keys are validated at the config boundary (`[a-zA-Z0-9._-]` required) — keys flow into shell invocations and generated TypeScript imports, so a hostile key from a remote/extended runtime config could execute commands or break out of generated code strings. `bos db studio` no longer spawns drizzle-kit through a shell.
- TLS certificate verification is now ON by default for non-local database connections (`DB_SSL_REJECT_UNAUTHORIZED=false` is the documented opt-out for self-signed deployments).
- SRI verification fails closed: a fetch failure during verification now throws instead of counting as verified, and a hash computation failure during deploy retries with backoff and then keeps the previous integrity field instead of deleting it from the published config.
- The exported NEAR publish key file is tightened to mode 0600; `bos key publish` warns loudly when the private key goes to non-interactive stdout (CI logs persist it).
- Env-sync drift logs mask credentials in `*_DATABASE_URL`/`*_SECRET`/`*_KEY` values.
