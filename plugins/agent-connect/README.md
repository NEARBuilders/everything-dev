# Agent Connect

Control plane giving every signed-in user an owner-controlled agent account on the
[NEAR Intents Agent API](https://api.agentsonintents.com) — the owner signs the rules
once with their wallet, and agents hold revocable `ngt_` grant tokens that only act
inside the owner-signed policy.

## Layering

- **`@near-intents-agent-api/sdk`** (catalog-pinned) is the only protocol dependency.
  Every domain type is re-exported from it, never re-declared. The hosted API is the
  source of truth for all shapes (`/openapi.json`).
- **This plugin** adds only platform concerns: session ownership (auth context),
  the sealed grant-token vault, the pre-send intent ledger, and the oRPC surface
  (REST + MCP via the host's OpenAPI mounts).
- **`better-near-auth`** owns the wallet side: `signAgentIntent` (client surface)
  signs a generated `intent.payload` with the connected wallet — nep413, nep366,
  or webauthn — and the browser submits the wallet's output back here.

Flow (the BFF split): `agentCreate` / `prepareIntent` return `intent.payload` +
`preview` only → the browser signs → `intentSubmit` submits the wallet's output.
The `naa_` partner key and `ngt_` grant tokens never reach a browser.

## Invariants (enforced in code and tests)

1. Every route requires a session; every agent/grant/correlation id is checked
   against the calling user's rows before any host call.
2. Grant tokens are sealed at rest (HKDF-SHA256 → AES-256-GCM) and never appear in
   a response — only their sha256 commitment enters the owner-signed intent.
3. Intents are persisted **before** the send (status `PENDING_SIGNATURE`, 15-minute
   pre-send TTL) and linked to the real correlation id after; a failed link asks the
   caller to retry, which reuses the same idempotency key.
4. Idempotent prepare: `agentCreate`/`prepareIntent` accept an optional client
   `idempotencyKey` (8–128 chars, `[A-Za-z0-9._:-]`) — the same key with the same
   request replays the stored intent (or resends the exact stored request body under
   the same key), and the same key with a different request type conflicts. Upstream
   still enforces body equality (`409 idempotency_conflict`).
5. Submit and status polling share one reconciliation path: a `SUCCESS` observed
   later applies the same local effects as an immediate one (grant id linked, revoke
   marked, agent row activated). Ledger writes are best-effort; the intent-link
   failure is fatal.

## Configuration

- Secret `NEAR_INTENTS_AGENT_API_KEY` (`naa_…`, partner dashboard) — the plugin is
  dormant without it (routes fail with a clear "not configured" error).
- Secret `AGENT_CONNECT_ENCRYPTION_KEY` (32+ bytes) — grant vault key; falls back to
  a key derived from the API key when absent (set a dedicated key in production).
- Secret `AGENT_CONNECT_DATABASE_URL` — own `plugin_agent_connect` schema; `pglite:`
  default for local dev.
- Variable `apiBaseUrl` — hosted API origin (non-mainnet deployments point elsewhere).

## Upstream-first

Needs that require protocol changes go upstream (NEAR-Intents-Agent-API: `sdk-typescript`,
`skills`; private: `api`, `agent-connect`) — never forked locally. The vendored skill
(`.agents/skills/near-intents-agent-api`) is the rules source and drift-tracked via
`skills-lock.json`.
