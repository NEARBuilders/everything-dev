---
title: "08 · Identity"
description: Who a caller is — NEAR wallet, passkey, social, or API key — what they may do, and how an app lets them write on chain without paying gas.
order: 80
tags:
  - book
---

# 08 · Identity

Identity on the platform is NEAR-native. A user signs in with a NEAR wallet, a
passkey, or a social account; an organization scopes what they can do; an API key
lets an agent act for them; and sponsored keys let ordinary users write on chain
without holding gas.

## Sign-in

Authentication is Better Auth with **Sign In With NEAR (SIWN)** at its center: the
wallet signs a NEP-413 message naming the app, and the server verifies it against a
nonce. The auth library is `better-near-auth`; the auth plugin mounts it, adds
organizations, teams, API keys, and passkeys, and publishes the session to every
plugin through the request context.

Three classes of identity value are derived by rule, and never mixed up:

| Class | Examples | Derived from |
|---|---|---|
| Origin-bound | Base URL, passkey relying-party ID, onboarding QR origin | The runtime's gateway domain — never a per-request tenant |
| Presentation | Relying-party name, email sender name | The runtime's title |
| Protocol labels | Device-link client ID | Constants or explicit config — persisted identifiers must not change when a domain does |

([ADR 0025](../adr/0025-auth-identity-value-classes.md))

**Passkeys are bound to the gateway origin.** A passkey is tied forever to the
relying-party ID it was created under, so every ceremony runs on the gateway origin
whatever tenant domain the user arrived from. Changing that ID would orphan every
passkey ever issued. Sign-up is one ceremony: a passkey-first registration creates
the session and links the passkey wallet in a single prompt.
([ADR 0013](../adr/0013-passkeys-bound-to-gateway-origin.md),
[ADR 0014](../adr/0014-single-ceremony-passkey-sign-up.md))

**One owner for the session read path.** Every session read funnels through one
module, `everything-dev/ui/auth`, shared as a singleton across the core UI and every
plugin UI. Two copies of it once disagreed into a redirect loop; there can be only
one. ([ADR 0018](../adr/0018-session-single-owner.md))

## Organizations, teams, and permissions

Access is **declared in config, and undeclared means denied**. The auth plugin ships
no permission defaults. A runtime declares a catalog of statements —
`member: ["create", "delete"]`, `email: ["read"]` — and the grants each role carries,
including custom roles. A config that grants something it never declares, or that
omits `owner`, `admin`, or `member`, fails at boot naming the offending grant. The
whole posture is visible in the published config and auditable on chain.

Every plugin sees the caller's **effective permissions** in its request context and
checks them with `requirePermission(resource, action)`. Team roles restrict within a
team; no route bypasses the organization's own role checks.
([ADR 0028](../adr/0028-config-declared-permissions.md))

## Gasless writes

Most users should not need NEAR to use an app. Two mechanisms share one funded
account — the **Sponsor** in its funding role, the **relayer** in its signing role:

| Path | When | How |
|---|---|---|
| **Session gas keys** (primary) | The wallet supports gas keys and the user opts in | A key scoped to one contract method is installed on the user's account and funded by the Sponsor; the browser then signs writes locally, in parallel, with no relayer on the hot path |
| **Relayer** (fallback) | Any other wallet, or an emergency | The user signs a delegate action; the relayer submits it, enforcing a contract allowlist and gas caps |

Guardrails are enforced server-side: the fund endpoint checks the key's on-chain
balance and a per-user lifetime cap before signing. Both paths draw on one account,
so a deployed runtime must keep the relayer funded.
([ADR 0017](../adr/0017-session-gas-keys.md))

## Wallets across apps

A passkey wallet's account is portable; the credential that controls it is not. The
**cross-app wallet claim** lets a wallet created on one app be used on another: the
app that owns the credential hosts the signing ceremony, and the claiming app
verifies the proof against a configured allowlist and links the account to its local
user. ([ADR 0039](../adr/0039-cross-app-wallet-claim.md))

## Agents

Every API surface — REST, oRPC RPC, plugin RPC, MCP — accepts the same credentials: a
session cookie or an `x-api-key` header. An agent gets a key with
`bos login`, or from **Settings → API Keys**, and can then work the running app over
MCP without cloning anything. The permission posture for API keys is the same
declared catalog. See [13 · Reference](13-reference.md) for the entry points.

## Check it

- `/settings/api-keys` — create and inspect keys.
- `/.well-known/mcp.json` on a deployed runtime — the MCP descriptor.
- `/admin/relayer` — the relayer account and its funding.

## Further reading

- The [`everything-dev#talk-to-the-app`](../../packages/everything-dev/skills/talk-to-the-app/SKILL.md) skill — working a running app as an agent.
- The [`better-near-auth#auth-plugin`](../../packages/better-near-auth/skills/auth-plugin/SKILL.md) skill, and its siblings for the client, the SIWN server, and the relay.
- The [`everything-dev#api-and-auth`](../../packages/everything-dev/skills/api-and-auth/SKILL.md) skill — auth middleware in a plugin.
- Next: [09 · Publishing](09-publishing.md).
