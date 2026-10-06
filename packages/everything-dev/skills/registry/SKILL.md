---
name: registry
description: Read and write the FastKV config registry efficiently — key layout, namespace=signer semantics, integrity, and composing published runtimes into the local authored config. Use when publishing configs, composing another runtime's UI/host/api/plugins, or debugging why a published config doesn't resolve.
metadata:
  sources: "packages/everything-dev/src/fastkv.ts,packages/everything-dev/src/publish.ts,packages/everything-dev/src/near-signer.ts,packages/everything-dev/src/registry-use.ts,packages/everything-dev/src/plugin.ts"
---

# FastKV Registry — Efficient Read & Write

## The one law: namespace = transaction signer

FastKV (`__fastdata_kv` on `dev.everything.near` mainnet / `dev.allthethings.testnet` testnet) has **no ACL** — anyone can write any key. Access control lives entirely in the **read indexing**: entries resolve at `/v0/latest/<contract>/<predecessor_id>/<key>`, where `predecessor_id` is the account that **signed** the write.

Consequences:

- A config published at `bos://<account>/<gateway>` is visible **only if signed by `<account>` itself** (FCAK or wallet/NEP-366 delegate).
- A relayer signing its own transaction writes to the *relayer's* namespace — invisible at the publisher's bos:// URL. There is no "sign on behalf of" without the publisher's key (direct FCAK or NEP-366 delegate).
- Reads cannot be poisoned by third parties; a leaked FCAK can only pollute its own account's namespace.
- Every read response carries `predecessor_id`, `block_height`, `block_timestamp`, and the entry `key` — on-chain provenance for free.

## Key layout

```
apps/<account>/<gateway>/bos.config.json          # a published runtime config
nostr/<account>                                    # (contextual.near) NEAR↔nostr identity binding
```

Read URL (plain HTTP, no auth):

```
https://kv.main.fastnear.com/v0/latest/dev.everything.near/<account>/apps%2F<account>%2F<gateway>%2Fbos.config.json
https://kv.test.fastnear.com/...                                            # testnet
```

Or in code: `fetchBosConfigFromFastKv("bos://<account>/<gateway>")` from `everything-dev/fastkv`.

## Writing (bos publish)

`bos publish [--deploy]` signs the registry transaction **in-process** via near-kit — no near-cli-rs, no external binary:

1. Key resolution: explicit key → `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` env → `~/.near-credentials/<network>/<account>.json` (near-cli-rs compatible, via `FileKeyStore`) → near-cli-rs OS keychain (`sign-with-keychain`, interactive terminals only).
2. The transaction is a function call on the namespace contract (`__fastdata_kv`) with `{ "apps/<account>/<gateway>/bos.config.json": "<config json>" }`, gas `300 Tgas`, deposit `0`.
3. Publishes are **skipped** when FastKV already holds an identical config (`isConfigAlreadyPublished`) — free no-op detection before spending gas.
4. `waitForPublishedConfig` re-reads the registry until the published value matches (confirmation, ~120s timeout).

Mint the scoped signing key with `bos key generate` (function-call key restricted to `__fastdata_kv` with an allowance — the allowance bounds leak damage).

## Reading / composing another runtime (bos registry use)

```bash
bos registry use v1.citynode.near/citynode.app --sections app.ui,app.host --dry-run
bos registry use v1.citynode.near/citynode.app --sections app.ui,plugins.apps
```

- Composable sections: `app.ui`, `app.host`, `app.api`, `app.auth`, `plugins.<key>` — taken verbatim (production URL + integrity) from the published config.
- Everything else in the local authored config (account, domain, extends, other sections) is preserved.
- `--dry-run` previews; after writing, run `bos types gen` to refresh generated types.

`extends` (inherit a whole runtime lineage) vs `registry use` (attach specific sections): extends merges the parent's config at resolution time; registry use copies concrete sections into your own config — pick extends for inheritance, registry use for à-la-carte composition.

## Common mistakes

- **Config "missing" after publishing with the wrong key** — the write landed under the signing account's namespace, not the config's `account`. Sign with the account named in the authored config.
- **Editing the committed authored config URLs and expecting runtime changes** — the runtime source of truth is FastKV; the repo copy is the publish *input*.
- **Expecting near-cli-rs for publish** — signing is in-process; near-cli-rs is only needed for `bos key generate` (interactive keychain) and account management.

## The tasks you will actually be given

**"Attach a section from another runtime."** `bos registry use <account>/<gateway> --sections app.ui,plugins.apps --dry-run` first, then the real run, then `bos types gen` to refresh generated types.

**"Debug: my publish isn't visible."** Fetch the exact read URL (`https://kv.main.fastnear.com/v0/latest/dev.everything.near/<account>/apps%2F<account>%2F<gateway>%2Fbos.config.json`) and compare the response's `predecessor_id` to the account you signed with.

**"Publish without double-spending gas."** Just run `bos publish` — `isConfigAlreadyPublished` skips identical configs before signing, and `waitForPublishedConfig` confirms the read-back (~120s timeout).

## What comes back when it refuses

| word | do |
|---|---|
| read 404 / config "missing" right after publish | the write landed under the signer's namespace, not the config's `account` — sign with the account named in the authored config (`bos key generate` FCAK, or the wallet/delegate) |
| publish errors before signing | preflight failed — key resolution or registry URL; check `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` / `~/.near-credentials/<network>/<account>.json` |
| `waitForPublishedConfig` timeout | the read-back didn't match within ~120s — fetch the URL by hand; if `predecessor_id` is wrong, the wrong key signed |
| relayer-signed publish invisible | a relayer signing its own tx writes to the *relayer's* namespace — there is no sign-on-behalf; use the publisher's FCAK or a NEP-366 delegate |
