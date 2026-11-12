---
"everything-dev": minor
---

Secrets vault v1: sealed runtime secrets behind the existing env resolution (plan 055 ticket 09).

- `bos secrets set NAME` (hidden TTY prompt), `bos secrets list` (names + set/missing status against the declared config — never values), `bos secrets remove NAME`.
- The api shell gains a per-deployment vault: `runtime_secrets` table (migration auto-applies on boot), routes at `/api/rpc/secrets/*` and `/api/secrets/*` (session or `x-api-key` auth), values sealed with the proven `createSealedBox` cipher under a per-runtime KEK (HKDF of the platform root secret with a runtime-scoped salt — no new env var, no key ceremony).
- Reserved-name contract: `BOS_*` and `PORT` are refused — the platform composes them into instance env (`identityEnv`), and operator secrets must never collide with the composed identity. Rules live in the new `everything-dev/hosting/secrets` subpath (store, CLI, and the delivery helper share one source).
- `SecretsStore.resolve` (unseal) exists at the service level for the reconciler's delivery leg but is deliberately not exposed as a route — the delivery credential is ticket 08's design decision.
- Dev-restart caveat: with zero-config dev's per-run root secret, stored secrets cannot be opened after a restart; resolution fails loudly with a re-set message. Deployed runtimes with a persisted root secret are unaffected.
- The stale `bos key generate` section is removed from the cli-reference skill (command was retired in the RC path consolidation).
