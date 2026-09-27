# City Node

A node in the City Node network — a self-referencing tree where `parentId` is the only hierarchy axis and any kind of community (geo, org, user, zone root) is the same shape. Geographic nodes are owned by a node DAO and optionally backed by a staking pool; the kind label lives in node metadata.

## Language

**Node DAO Account**:
The node DAO's NEAR account — the account that stakes into the node's pool.
_Avoid_: team account, team wallet, org account, user wallet

**Staking Pool**:
The validator pool contract the node resolves for staking.
_Avoid_: validator (the metadata record), total staked (the whole pool)

**Node DAO Stake**:
The Node DAO Account's current stake in the node's Staking Pool, including compounded validator rewards.
_Avoid_: available rewards (product label for this same quantity), total staked, pool stake

**Validator Rewards**:
NEAR already compounded into Node DAO Stake. Not a separately held balance.
_Avoid_: reward balance, pending rewards

## Organization access

**Team**:
A named sub-group within an organization that shares access to the organization's feature areas.
_Avoid_: team account, team wallet, node DAO

**Active Team**:
The Team currently selected for a user's organization work.
_Avoid_: current team, team account

**Feature Area**:
A product capability that an organization can grant to a Team.
_Avoid_: permission, role

**Team Workspace**:
The organization view scoped to an Active Team and its granted feature areas.
_Avoid_: node workspace, organization account

## Community discovery

**Discovery Profile**:
A node's public community identity, including its chosen geographic location and official social channels.
_Avoid_: validator profile, node DAO account

**Community Activity**:
A published event or social update associated with a node and visible to visitors.
_Avoid_: staking activity, validator uptime

**Active Node**:
A publicly discoverable node with recent Community Activity or an upcoming published event.
_Avoid_: online node, active validator

**Node Event**:
A community gathering associated with one or more nodes, with a scheduled time and a public destination for event details or registration.
_Avoid_: blockchain event, transaction

**Social Update**:
A node-associated public post with an attributed source, original publication time, and a link to the original content.
_Avoid_: social account, imported activity

## Event onboarding

**Onboarding Code**:
A revocable, expiring, use-capped invitation tied to one Node Event that makes whoever redeems it a member of the node's organization and of that event's Event Team; shown as a QR code.
_Avoid_: join link, invite code, referral code, QR code (that's only its rendering)

**Event Team**:
A Team created for one Node Event whose members are the people who redeemed its Onboarding Codes; it is granted no Feature Areas unless an organizer adds them.
_Avoid_: event cohort, attendee list

**Organizer**:
A member who can create and revoke Onboarding Codes for a node's events, by belonging to a Team granted the events Feature Area, or by being an organization owner or admin.
_Avoid_: event admin, host

**Passkey Wallet**:
The deterministic NEAR account derived from a member's passkey public key, linked to their user at onboarding; it exists as an address before it is activated on-chain.
_Avoid_: passkey account, embedded wallet, smart wallet

**Activation**:
The first sponsored on-chain deployment that makes a Passkey Wallet a live account able to hold keys and sign writes.
_Avoid_: funding (that's the Sponsor topping up a key), creation

**Gateway Origin**:
The canonical citynode.app origin for a network, where every passkey ceremony takes place regardless of which tenant domain the member arrived from.
_Avoid_: base URL, main domain, tenant domain

**Device Link**:
Signing a desktop browser into an existing session by approving the desktop's QR code from a phone that is already signed in.
_Avoid_: device pairing, sync, cross-device passkey (the browser-native hybrid flow is a different mechanism)

## Regression stacks

**Stack**:
The fixture a regression suite runs against: `start` (the production command — the host booted over locally built, statically served artifacts via `bos start --config`) or `dev` (the dev server, `bos dev` — smoke-covered only).
_Avoid_: environment (that's `production`/`staging`), target

**Variant**:
The render mode a stack runs with: `ssr` (server-composed) or `csr` (no ssr URL — the client composes). Written `stack:variant` (e.g. `start:csr`); a bare stack name runs both variants serially (`test:regression:start` / `test:regression:dev`).
_Avoid_: mode (reserved for `production`/`staging` env), project

**Stall Watchdog**:
The Playwright reporter that fails the suite after minutes of zero test progress, printing a runner snapshot so a freeze produces evidence instead of eating the job timeout.
_Avoid_: timeout (the job-level kill; the watchdog exists because that kill loses artifacts)

## Gasless transactions

**Gas Key**:
A NEAR access key (NEP-611) with its own prepaid gas balance and parallel nonce lanes; gas burns from the key's balance, not the account's.
_Avoid_: prepaid key, allowance (a function-call key's allowance spends the account's own NEAR — a different mechanism)

**Session Gas Key**:
The browser-generated Gas Key scoped to the FastKV namespace's `__fastdata_kv` method, bootstrapped onto a user's account at their opt-in and used to sign platform writes locally.
_Avoid_: session key, FCAK, gas key (that's the protocol concept — be specific about which)

**Sponsor**:
The funding role of the ephemeral relayer account: it tops up Session Gas Keys via `TransferToGasKey` under server-enforced per-user caps.
_Avoid_: relayer for this role (the relayer is the NEP-366 role of the same account — say which you mean)

**Bootstrap**:
The one-time, wallet-signed `AddKey` transaction that installs a Session Gas Key on the user's account; refused for wallets whose manifest lacks `features.gasKeys`.
_Avoid_: provision, register

**Lane**:
One of a Gas Key's independent nonce sequences; parallel sends pick different Lanes and never serialize on each other.
_Avoid_: nonce (the per-lane counter), slot
