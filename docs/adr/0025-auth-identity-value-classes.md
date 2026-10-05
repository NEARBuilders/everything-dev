# ADR 0025: Auth identity values derive from the runtime config

Date: 2026-10-04
Status: Accepted

Auth-plugin identity values fall into three classes, each with one derivation rule. **Origin-bound** values (Better Auth `baseUrl`, passkey `rpID` and `origin`, onboarding QR gateway origin) derive from the runtime's gateway `domain` via `buildAuthBaseVariables` — and never from a per-request tenant, because a shared-host tenant deriving its own rpID would orphan every passkey (ADR 0013). **Presentation** values (`rpName`, email from-name) derive from the runtime `title`, so a tenant or child runtime shows its own name in ceremonies without authoring anything. **Protocol labels** (`deviceLink.clientId`, `bos-cli`) are persisted identifiers (`deviceLinkClaim` rows, the `validateClient` allowlist) — they stay immutable constants or explicit authored variables and are never auto-derived from mutable config (a domain or account rename must not orphan claim history).

## Considered Options

- **Auto-derive `deviceLink.clientId` from account/domain** — one less authored field, but couples a persisted label to mutable config. Rejected.
- **Per-tenant `rpName` per request on the shared host** — the host core is fixed today; when per-request auth swapping arrives, presentation values must keep sourcing from the base runtime snapshot for ceremony continuity. Deferred with that constraint recorded.

## Consequences

- `rpName` fallback chain: authored `passkey.rpName` → runtime title → host domain; the `"Everything Dev"` literal is deleted.
- `DEFAULT_DEVICE_LINK_CLIENT_ID` stays the neutral package default; authored `deviceLink.clientId` stays explicit.
- Per-request auth swapping (plans direction) must keep origin-bound and presentation classes sourced from the base runtime snapshot.
