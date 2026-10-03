# ADR 0001: FastKV registry namespaces are self-authenticating — publishes sign with the publisher's own NEAR key

Date: 2026-09-01
Status: Accepted

## Context

The config registry is FastKV: a `__fastdata_kv` function on `dev.everything.near` (mainnet) / `dev.allthethings.testnet` (testnet), read over HTTP at `https://kv.main.fastnear.com/v0/latest/<contract>/<predecessor_id>/<key>`. A published runtime config lives at `bos://<account>/<gateway>` → key `apps/<account>/<gateway>/bos.config.json`.

We evaluated replacing CI's `NEAR_PRIVATE_KEY` (a scoped function-call access key, FCAK) with nostr-signed events authorized by NEAR↔nostr bindings (the nostr plugin's `contextual.near` binding flow), with a relayer submitting the registry write. An on-chain spike produced three decisive findings:

1. **The `__fastdata_kv` contract has no ACL.** `contextual.near`'s deployed WASM is 327 bytes exporting only `__fastdata_kv` — any funded account can write any key.
2. **Reads are indexed by transaction signer.** The read response carries `predecessor_id`; the same key queried under a different predecessor returns empty. A config is visible at `bos://<account>/<gateway>` **only if the write was signed by `<account>`**.
3. **Bindings are therefore impersonation-proof** — a binding for account X can only appear under X's own signer segment — but equally, **a relayer-signed write is invisible to the publisher's namespace**. A nostr event cannot authorize a namespace it does not sign for; NEP-366 delegates require the publisher's NEAR key anyway.

Addendum (same day, from a production publish failure): the registry write is **action-indexed, not execution-verified**. `dev.everything.near`'s `__fastdata_kv` is a stub — its contract need not exist or execute; FastNear's indexer records the `__fastdata_kv` action call from the transaction itself. The legacy near-cli-rs flow's tolerated `CodeDoesNotExist` exit-1 encoded this. Consequently `bos publish` submits with `waitUntil: "NONE"` and treats `waitForPublishedConfig` (the read-back) as the authoritative success check: execution outcomes on this contract are not meaningful, while submission-level failures (invalid signature, exhausted allowance) still abort.

## Decision

- **Publishes sign with the publisher's own NEAR key.** `bos publish` builds and signs the registry transaction in-process via `near-kit` — no near-cli-rs shell-out, no key passed through argv. Key resolution: explicit key → `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` env → `~/.near-credentials/<network>/<account>.json` (near-cli-rs compatible) → near-cli-rs OS keychain (`sign-with-keychain`), which keeps keys inside the keychain for local interactive publishers.
- **Nostr is dropped from the publish path.** It duplicates nothing the chain doesn't already provide (see Consequences) and cannot grant write authority. The nostr plugin remains available for identity/social features (comments, builder profiles) as a separate concern.
- **`bos key generate` stays** — minting a scoped FCAK (restricted to `__fastdata_kv`, allowance-capped) remains the publisher's onboarding step.
- **No-op publishes are skipped**: `isConfigAlreadyPublished` compares the FastKV value with the payload before submitting, saving allowance and the confirmation wait.
- **CI carries `NEAR_PRIVATE_KEY` / `NEAR_TESTNET_PRIVATE_KEY`** as GitHub secrets; the near-cli-rs install steps were removed (signing is in-process).

## Consequences

- Blast radius of a leaked FCAK is bounded: the attacker can only write under the leaked key's own namespace until the allowance is exhausted; reads for other accounts are unaffected.
- Publish provenance is on-chain and free: every read response exposes `predecessor_id`, `block_height`, `block_timestamp`, and tx hash.
- Unattended publishing requires the account's own key material. A "gasless" alternative would require the platform to custody encrypted per-account FCAKs (rejected for now: new trust surface, key-deposit flow, and lifecycle burden).
- The repo copy of `bos.config.json` is the publish **input**; deploy workflows do not commit back (the runtime fetches from FastKV via `BOS_ACCOUNT`/`BOS_GATEWAY`).
- Composing another runtime's sections is a read-side convenience (`bos registry use <account>/<gateway> --sections app.ui,plugins.<key>`); it never bypasses signer scoping because it copies config values, not write authority.
