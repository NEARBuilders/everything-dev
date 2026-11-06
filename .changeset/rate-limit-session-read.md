---
"everything-dev": patch
---

Rate-limit hardening for the signed-out symptom (#634): `GET
/api/auth/get-session` is exempt from the general `/api/*` bucket — a 429 on
the session read is what made the UI present "signed out" — while the
mutation tier is unchanged. `docs/self-deploy.md` documents `RATE_LIMIT_MAX`
/ `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MUTATION_MAX` as instance tunables.
(The limit raise to 2000 and trusted-proxy keying already shipped; the
client-side false-empty flashes are #683.)
