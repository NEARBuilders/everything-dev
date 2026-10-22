---
"everything-dev": minor
---

RC path consolidation: remove two dead/duplicate CLI doors and the retired `ci.image` schema key.

- `bos infra export` is deleted — it had no consumers (the deploy workflow stopped calling it; the only other reference was its own test).
- `bos key generate` is deleted — `bos login --key` is the single publish-key minting path. The removed command printed the private key to stdout (a log-capture leak the code itself warned about); `bos login --key` exports to the near-cli-rs keystore instead. User-facing messages that pointed at `bos key generate` now point at `bos login --key`.
- The authored descriptor schema no longer accepts `ci.image` — a `bos.app.ts` that sets it now fails schema validation (it was already rejected at deploy time).
