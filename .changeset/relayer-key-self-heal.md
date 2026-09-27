---
"better-near-auth": minor
---

Self-heal the ephemeral relayer key when decryption fails. The `relayer_key` row is encrypted under `BETTER_AUTH_SECRET` (HKDF → AES-256-GCM); after a secret rotation every boot failed with `Cipher job failed` / `OperationError` and the relay stayed permanently disabled until the rows were deleted by hand. Since a GCM auth-tag mismatch means the private key is already unrecoverable, `initRelayer` now deletes the undecryptable row and generates a fresh ephemeral keypair, warning loudly with the stranded implicit account id (fund the new account to re-enable gasless relay). Only the decrypt call is treated as recovery-worthy — transient failures elsewhere in the recovery path never delete the stored key.
