# The target state: an elegant runtime for apps and agents

> **Category**: direction — this is a vision doc, not an executor plan. It
> records the target state of the platform and the decisions and open design
> space that follow from it. Decisions recorded here graduate into ADRs when
> they land; open items graduate into wayfinder tickets when they are ready
> to be decided. Nothing in this doc gates an executor.

## Thesis

Humans own wallets and sign rules. Agents act through scoped credentials.
Apps are published compositions. Machines are rented, pinned images. And
everything durable is on-chain.

A developer writes one authored file (`bos.app.ts`); the runtime composes it.
A user signs in once and automatically holds everything they need — session,
platform access, publish identity, payment rail. An agent holds nothing and
acts through credentials scoped to one plane each. No principal ever holds
more key than its plane requires.

"For other apps" is the point: any app extends the root runtime, composes
plugins, and inherits the entire surface — auth, API, MCP, the deploy train,
the agent money planes — without building any of it. Tenants compose; agents
operate; the platform pays for itself at the seams where value moves.

## The primitives inventory

The underlying primitives, each grounded in what exists today, with what
stays open.

| Primitive | What it is | Grounded in | Open |
|---|---|---|---|
| **Identity** | Named NEAR account (vanity, subaccounts), implicit hex account (machine identity), custody wallet (`wk_`, TEE-held), agent account (on NEAR Intents) | ADR 0001 (namespace = signer), custody publish (see AGENTS.md "Custody publish") | Custody ↔ named-account bridge (decision: hex accepted for now — see "The default path") |
| **Credentials** | `api_` (platform access), `wk_` (custody: signing + compute payment), `naa_` (Agent API partner), `ngt_` (agent grant), session gas key (NEP-611), minted deploy keys | auth plugin (API keys, statements/roles), ADR 0017, `bos login --key`, OutLayer custody | Scoped publish delegate for CI (design below) |
| **Registry** | FastKV — self-authenticating namespaces (namespace = signer), action-indexed immutable writes, history as audit trail | ADR 0001 | Metering/fee hooks on writes (economy, below) |
| **Composition** | `bos.app.ts` authored descriptor; `extends` lineage; plugins; `bos import` byte-sourcing with SRI-verified source archives | ADR 0005, 0022, 0030; beta-v2 plan | — |
| **Distribution** | One universal image (digest-pinned), CDN bundles (SRI-pinned), the deploy train with post-publish smoke and rollback | ADR 0011, 0020, 0021 | — |
| **Tenancy & compute** | Tiers: shared-host tenants (`*.<root>`), own-instance children (`.<child>`), sandboxes (`*.*.<child>` — platform image on provisioned machines, lease-scoped) | ADR 0020/0021, plan 032 (spike) | Hot-swap lifecycle, request drain (wayfinder ticket 10); lease pricing |
| **Money** | NEAR Intents: policy (what may happen), grant (who may act), atomic integer amounts, idempotency keys, UNCERTAIN/NEEDS_REVIEW semantics | Agent API (api.agentsonintents.com), `@near-intents-agent-api/sdk`, better-near-auth agent-connect | Platform-side policy templates for apps |
| **Gas** | Three gasless planes (see below) | ADR 0017 (gas keys primary, relayer fallback), custody prepaid balance | Sponsored first publishes (economy, below) |
| **Access** | Platform API keys minted self-serve, permission statements/roles, org delegation | auth plugin permission registry, plan 053 | Key distribution economy (economy, below) |
| **Agent education** | MCP tools from OpenAPI, `/llms.txt`, `/skill.md`, vendored agent skills | host MCP surface, `.agents/skills/near-intents-agent-api` | Refresh cadence from NEAR-Intents-Agent-API/skills upstream |

### The five credentials, five planes

| Credential | Plane | Held by | Grants |
|---|---|---|---|
| wallet (NEAR / EVM / passkey) | ownership | the human | signs owner intents: policies, publishes, grants |
| `api_…` | platform access | a person, org, or agent | MCP / REST / oRPC on a runtime |
| `wk_…` | machine identity + compute payment | TEE (OutLayer) | signs publishes; pays agent compute and sandbox leases |
| `naa_…` | Agent API partner | the app backend | calls the hosted agent API |
| `ngt_…` | agent money authority | the backend, per agent session | moves funds inside an owner-signed policy |

### The three gasless planes

One mechanism per principal type — they never compose, by protocol:

| Principal | Mechanism |
|---|---|
| Browser user | Session gas key (NEP-611, sponsor-funded), NEP-366 relayer fallback |
| Machine / agent | Custody wallet prepaid balance via the OutLayer coordinator |
| Named-account owner | Their own gas (escape hatch) |

A gas key cannot sign delegate actions and `WithdrawFromGasKey` is refused
inside a delegate; the browser plane and the machine plane stay separate.
The custody publish path never touches the NEP-366 relayer.

## The target-state loop

An app's whole lifecycle, with no human ever holding a raw private key:

1. **Author** — `bos init` scaffolds; the developer (or an agent) writes
   `bos.app.ts`, declaring local workspaces and `extends`.
2. **Log in** — `bos login` is the one login: SIWN session + `api_` key +
   custody wallet registration (TEE-held `wk_`). The CLI prints the wallet's
   hex account, network, and funding handoff URL — never the key itself.
   When the `outlayer` CLI is present, the wallet links into it.
3. **Fund** — the custody wallet is funded once via the OutLayer handoff URL
   (manual for now; see economy). Its prepaid balance pays every publish.
4. **Publish** — `bos deploy` runs the train: preflight → build → bundle
   upload (SRI-verified, CDN) → FastKV publish signed by the custody wallet
   through the coordinator (`/wallet/v1/call` → `__fastdata_kv`, prepaid gas
   deducted, read-back confirmed) → universal image → post-publish smoke →
   Railway pinned to the digest. A red smoke rolls the config back.
5. **Inhabit** — tenants extend the runtime (`*.<root>` composition), users
   SIWN in and write gaslessly, agents get agent accounts with owner-signed
   policies and per-session `ngt_` grants.
6. **Operate** — every runtime is a full agent surface: MCP tools generated
   from OpenAPI, REST, oRPC, plugin RPC — all behind `api_` keys or sessions.
7. **Compute** — sandbox tier: agents rent machines (plan 032), paid from the
   same `wk_` balance, leases scoped and released like every Effect Layer.
8. **Audit** — every durable step is a FastKV write: config history, deploy
   manifests, custody signatures. The on-chain record is the source of truth.

## The default path

Decisions (operator, 2026-10-16):

- **Custody-first login.** `bos login` becomes the single login flow —
  session + `api_` key + custody wallet registration in one step. The
  `--custody` flag is dropped (it is the default); escape hatches remain as
  flags for named-account publishing.
- **`publish.auth` auto-resolves**: custody wallet stored → custody publish;
  else wallet session → session publish; else `NEAR_PRIVATE_KEY`. Explicit
  authored config still wins over auto-resolution.
- **`NEAR_PRIVATE_KEY` is an escape hatch** — advanced / named-account /
  break-glass use. `bos key generate` and the near-cli-rs steps move out of
  the default self-deploy flow into escape-hatch docs.
- **Relayer explicit mode (`RelayerExplicitConfig`) is deleted** — already
  vestigial; ephemeral mode is the only relayer configuration.
- **Funding is manual for now** — the handoff URL is documented in the login
  output and in the deploy failure path (`wallet_underfunded` 402 carries the
  exact cost). Sponsored first publishes and stake-to-start are open economy
  items, not onboarding blockers.
- **Hex namespaces are accepted** — custody runtimes publish under
  `apps/<hex-account>/<gateway>`; branding and routing ride on
  `domain`/`gateway`. A named-account bridge (link or delegate) may be
  designed later; it is not required.
- **Child CI signs with a scoped publish delegate** — the plan 042 "mint the
  token to set in CI" pattern extended from bundle uploads to FastKV writes:
  minted from the custody wallet, scoped to account/gateway, revocable, one
  secret in CI, no raw NEAR key anywhere.

### Graduation path (implementation backlog, not built yet)

1. `bos login` default flow: custody registration folded in, `--custody`
   flag retired.
2. `publish.auth` auto-resolution in `publish.ts` (custody → session →
   `NEAR_PRIVATE_KEY`).
3. Scoped publish delegate mint (extends the deploy-key mint server route to
   FastKV write scope).
4. Delete `RelayerExplicitConfig` + re-add-`NEAR_RELAYER_PRIVATE_KEY` docs.
5. Self-deploy doc rewrite around the 3-command default path.

## The economy layer (open design space)

Mapped, not decided. Each item graduates into a wayfinder ticket when it is
ready to be decided.

### Staking — the two senses

- **Staking for access** — a principal stakes NEAR to obtain or maintain
  access tiers: API-key quotas, sandbox lease eligibility, publish rate
  limits. The stake is sybil resistance and skin-in-the-game; it is
  collateral, not payment.
- **Staking to run infra** — operators (city nodes, sandbox hosts, tenant
  platforms) stake NEAR to participate in serving the network; the stake is
  forfeitable for abuse or downtime. This is the economic security layer for
  the compute tiers.

The primitives already support both: the custody wallet is a NEAR account
that can hold staked position, and FastKV's action-indexed writes make
access grants and their revocations auditable.

### Key issuance and distribution

- Platform `api_` keys: self-serve minting in Settings → API Keys (exists);
  org-scoped delegation and per-member/agent distribution (plan 053
  permissioning is the base); quotas as statements.
- Partner `naa_` keys: the hosted Agent API's partner dashboard — apps
  integrate by holding one backend key.
- Minted deploy keys / publish delegates: scoped, revocable, per
  account/gateway — the CI story above.

Open: who can mint for whom; whether staking gates issuance tiers; expiry
and revocation conventions; how tenants re-brand/re-sell keys to their own
users (the two-level distribution problem).

### Who pays whom

| Cost | Payer today | Open surface |
|---|---|---|
| Publish gas | custody wallet prepaid balance | sponsored first publishes; publish fees |
| Browser user writes | Sponsor (capped) | sponsor budget tiers; stake-to-raise caps |
| Sandbox compute | `wk_` payments (planned, plan 032) | lease pricing; marketplace of hosts |
| Bundle storage / CDN | platform (R2) | borrowed-storage cold start (plan 042); storage rent |
| Agent executions | users move their own funds inside policies | platform fee via Intents solver spread |

### Revenue surfaces the primitives already expose

1. **Compute** — metered sandbox leases paid from `wk_` balances (the same
   credential that signs publishes pays for the machines; nothing new to
   collect).
2. **Sponsorship beyond caps** — sponsored publishes/writes above the free
   tier.
3. **Agent execution flow** — the platform as a high-volume `naa_` partner:
   fee or spread share on the money its apps' agents move.
4. **Staking float** — staked access collateral earns yield while locked
   (stNEAR-style), aligning the platform's carry with users' security.
5. **Tenant services** — premium composition features (SSR gating is already
   a per-tenant column; provisioned infra per plan 031).

## Use cases this unlocks

- **Zero-key onboarding** — `bos init` → `bos login` → `bos deploy`; no
  near-cli-rs, no env secrets, no crypto knowledge required to run a
  production app.
- **Agents as full-stack deployers** — an agent with a custody wallet
  authors, publishes, rents compute, and operates an app end to end; a human
  signed a policy once.
- **Supply-chain posture** — no plaintext private keys in CI secrets or
  repos, ever; TEE-held keys and revocable scoped delegates replace them.
- **Apps with agent economies built in** — a tenant app embeds agent
  accounts via better-near-auth's agent-connect (hosted API, `naa_`/`ngt_`),
  so its users' agents hold and move funds inside owner-signed policies.
- **A marketplace of runtimes** — the spreadability tree
  (everything.dev → citynode.app → chicago.citynode.app) extends downward
  forever; each hop is a FastKV record, not a fork.

## Agents domain engine posture

Decision (operator, 2026-10-16): **hosted-first**. The hosted Agent API is
the only money plane for now. The vendored self-hosted control plane
(deploy-agents-rebuild sprint, Stream B) is paused; the
`better-near-auth` agent-connect plugin (SDK against
api.agentsonintents.com) is the integration surface. The wire contract is
the stable seam — the vendoring decision is reversible without touching
call sites, and tickets 14–15 (upstream proposals to
NEARFDE/near-intents-agent-api) remain the long-run convergence path.

## Consulted parents

- [beta-v2/](../beta-v2/) — composition vision (`app.ts`, tiers, tenants)
- [wayfinder/beta-v2-map.md](../wayfinder/beta-v2-map.md) — decision map;
  the "Everything is a node" wayfinder (citynode.app#233–#252) re-derives
  tenancy in node/zone vocabulary and consults this doc
- [deploy-agents-rebuild/](../deploy-agents-rebuild/) — deploy consolidation
  (landed) + agents rebuild sprint (paused, hosted-first)
- ADRs 0001, 0011, 0017, 0020, 0021, 0022, 0030; plans 031, 032, 042, 053
- Agent API skill: `.agents/skills/near-intents-agent-api/` (vendored from
  NEAR-Intents-Agent-API/skills; upstream currently ships no LICENSE file —
  flagged for an upstream MIT request)
