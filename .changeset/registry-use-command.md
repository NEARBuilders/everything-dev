---
"everything-dev": minor
---

Add `bos registry use` — compose sections from a published runtime into local `bos.config.json`.

- `bos registry use <account>/<gateway> --sections app.ui,app.host,plugins.<key>` fetches the published config from FastKV and merges the selected sections (production URLs + integrity) into the local config, preserving everything else (account, domain, extends, development URLs).
- `--dry-run` previews the merge; unknown sections fail with the list of composable sections available on the remote runtime.
- After writing, run `bos types gen` to refresh generated types.
- Ships with a new `registry` skill documenting the FastKV key layout, the namespace=signer law, and efficient registry read/write patterns.
