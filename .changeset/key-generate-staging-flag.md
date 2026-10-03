---
"everything-dev": minor
---

Add `--env staging` flag to `bos key generate`.

- `bos key generate --env staging` resolves the staging account from `bos.config.json`'s `staging.account` field (falling back to the top-level `account` if unset), matching the behavior of `bos publish --env staging`.
- The network is inferred from the resolved account (`.testnet` suffix → testnet, else mainnet), same as before.
- CLI output now suggests the correct GitHub Actions secret name: `NEAR_TESTNET_PRIVATE_KEY` for staging, `NEAR_PRIVATE_KEY` for production.
- The `KeyPublishResult` now includes an `env` field indicating which environment the key was generated for.
