---
"everything-dev": patch
---

Add self-deployed development docs to AGENTS.md and child project scaffold.

- Document the independent self-deployment workflow: create a NEAR account via near-cli-rs, generate a publish key with `bos key generate`, set `extends` in `bos.config.json`, `bos publish --deploy`, and run your own Railway host with `BOS_ACCOUNT` + `BOS_GATEWAY` (same gateway, own account).
- Explain that `BOS_GATEWAY` is the FastKV lookup key, not the DNS domain — keeping the same gateway while using your own account inherits the base platform via `extends` and overrides only what you change.
- Document subaccount creation setup with near-cli-rs: named account requirement, full access key export, `NEAR_SUB_ACCOUNT_PARENT_KEY` secrets, and `siwn` variable updates.
- Add a near-cli-rs quick reference table.
- Include the self-deploy section in the scaffolded child project AGENTS.md template (`bos init`).
- Add a "Self-Deployed / Tenant Publishing" subsection to the `publish-sync` skill.
