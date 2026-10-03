---
"everything-dev": minor
---

`bos publish` signs FastKV registry transactions in-process via near-kit.

- Replaces the near-cli-rs shell-out: the publish transaction is built and signed with `near-kit` directly (no external binary, no curl|sh installer in CI, no key passed through argv).
- Key resolution: explicit key or `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` env, falling back to the near-cli-rs credentials file at `~/.near-credentials/<network>/<account>.json`; when neither exists on an interactive terminal, signing falls back to the near-cli-rs OS keychain (`sign-with-keychain`) so existing local keys keep working; actionable error when nothing is available.
- Real transaction hashes come from the RPC outcome instead of regex-parsing CLI output. The transaction is submitted with `waitUntil: "NONE"`: FastKV writes are action-indexed (the namespace contract need not exist or execute — a `CodeDoesNotExist` execution outcome is expected), so publish succeeds when the indexer reflects the write, verified by the confirmation loop. Submission-level failures (invalid signature, exhausted allowance) still abort with actionable errors.
- Publishes are skipped when FastKV already holds an identical config (`isConfigAlreadyPublished`), saving allowance and the confirmation wait.
- `near-cli.ts` is slimmed to key management (`bos key generate`); CI workflows drop the NEAR CLI install steps.
