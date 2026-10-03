# ADR 0017: Session gas keys are the primary gasless write path, the relayer is the fallback

Date: 2026-09-24
Status: Accepted

## Context

Gasless user transactions today run entirely through the NEP-366 relayer: the
ephemeral relayer account must be online and funded for every single user
transaction, serializes on one nonce, and enforces gas/deposit limits in plugin
code. NEAR shipped gas keys (NEP-611, protocol 85): access keys with their own
prepaid gas balance and parallel nonce lanes. Gas burns from the key's balance,
anyone can top it up (`TransferToGasKey`), and spend is bounded by that balance —
closing the drain-then-spam gap the relayer's whitelists patch in code.

The platform's dominant user-initiated on-chain write is the FastKV
`__fastdata_kv` call (app metadata, tenant config publish) — zero attached
deposit, single method, already relayed gaslessly or signed with scoped
function-call keys. That shape is exactly what a scoped gas key covers.

## Decision

1. **Session gas keys first, relayer otherwise.** When the connected wallet
   supports gas keys (`features.gasKeys` in its manifest) and the user opts in,
   a `GasKeyFunctionCall` key scoped to the FastKV namespace's `__fastdata_kv`
   method is bootstrapped onto the user's account (wallet-signed `AddKey` with
   `gasKeyInfo`), funded server-side by the ephemeral relayer account
   (`TransferToGasKey`), and the browser signs subsequent writes locally via
   near-kit (`.signWith(pk).useGasKey(lane)`). The relayer drops off the hot
   path but remains permanent fallback infrastructure for non-`gasKeys` wallets,
   DAO flows, and emergencies.
2. **The wallet connector is the fastnear fork.** `@hot-labs/near-connect`
   (0.11.4, stagnant) cannot express gas-key actions; `@fastnear/near-connect`
   0.14.1 — the same fork lineage and the line Meteor wallets actually run —
   can. The dependency swaps wholesale, with one tracked patch
   (`patches/`): the fork dropped `cspNonce` support that @hot-labs 0.11.4 had,
   and production strict CSP blocks sandbox-wallet executor iframes without it,
   so the nonce threading is restored via `patchedDependencies`. This is
   reversible: if `@hot-labs` ships gas-key support, swapping back is
   mechanical because the API surface is identical (the patch retires with it).

   Update (2026-10-01): reversed, exactly as predicted. The connector is now
   `@hot-labs/near-connect` installed from the maintained gas-key-capable fork
   `elliotBraem/near-connect#v0.12.0-fork.2` (same lineage, adds gas-key
   actions, native `cspNonce`, iframe dispose guard). The fastnear swap caused
   wallet-login regressions; the tracked patch and `patchedDependencies` are
   gone, and near-kit's peer typing (`@hot-labs/near-connect >= 0.11.0`) is
   satisfied natively again.
3. **Sponsorship guardrails are server-enforced, not client-claimed.** The fund
   endpoint verifies the on-chain key balance is below the top-up threshold and
   enforces a per-user lifetime cap before signing any `TransferToGasKey`. Worst
   case per user is bounded and tiny; the deposit-free scope means the key can
   only ever burn its own prepaid balance.
4. **The legacy sub-account FCAK surface is removed**
   (`addRelayerFCAK`/`relayerFCAK`, `NEAR_SUB_ACCOUNT_PARENT_KEY_*` secrets) —
   it was unused, and its allowance semantics (spending the user's own NEAR) are
   replaced by the sponsor-funded gas key.

## Considered options

- **Relayer upgrade to V2 delegates** (near-kit `delegateV2`, NEP-461): keeps
  the relayer on the hot path with parallel lanes and a bounded prepaid balance.
  Dropped for now — it preserves the relayer's per-transaction uptime
  requirement instead of removing it; revisit if session gas keys prove
  unsuitable for a flow.
- **Wait for `@hot-labs` gas-key support**: blocks the feature indefinitely on a
  stagnant dependency while a maintained compatible fork exists.
- **Server-held gas keys** (encrypted like the relayer key, signed server-side):
  reintroduces a server signing hop — the relayer shape with extra steps.

## Consequences

- Key material lives in browser IndexedDB, per browser. Cache clear ⇒ the key is
  lost and a re-bootstrap adds a new one; stale keys are recorded server-side
  (`fundedGasKey` rows) so a later cleanup ticket can batch
  `WithdrawFromGasKey`+`DeleteKey` without schema change. Debris is bounded by
  the per-user cap; deleting a gas key burns its remaining balance by protocol
  design.
- The per-user funding cap is shared across devices — a second browser can
  exhaust the first's headroom. Accepted; per-device caps are a config knob
  later.
- Bootstrap is an explicit opt-in (`addSessionGasKey`), never an automatic
  sign-in prompt.
- The relayer account now plays two roles (NEP-366 relayer and session-key
  sponsor); its admin funding surface (`/admin/relayer`) is unchanged.
- Requires RPC protocol ≥ 85 on mainnet and testnet (both current) and
  `EXPERIMENTAL_view_gas_key_nonces` for lane reads.
