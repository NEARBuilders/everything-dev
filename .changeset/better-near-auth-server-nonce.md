---
"better-near-auth": minor
---

Fix deterministic sign-in failures caused by client/server clock skew, and make SIWN verification failures diagnosable.

ML-DSA-65 NEP-413 verification now uses correct borsh serialization for `callback_url: Option<String>` (one discriminant byte, Some followed by [u32 len][bytes]). The previous encoding wrote the Option as a u32, so signatures from real quantum-capable wallets (Rust/borsh — e.g. Intear) failed verification with "Invalid signature" even when the key, nonce, and message all matched. Test helpers now sign with the spec encoding, and the sandbox integration test signs without callbackUrl while the request includes it, matching real wallet behavior.

Sign-in nonces are now issued by the server (`/near/nonce`, server clock) instead of being generated from the user's device clock, so a device clock ahead of the server no longer fails login outright; the client falls back to a local nonce if the endpoint is unavailable. `accountId` on the nonce request is now optional (omit it to get a nonce before the wallet account is known). Nonce freshness validation tolerates up to 60s of future skew (previously any future timestamp was rejected), applied to both the ed25519 (via `nonceValidation: "none"` + local check) and ML-DSA-65 paths. Verify failures now return distinct error codes — `UNAUTHORIZED_NONCE_EXPIRED`, `UNAUTHORIZED_NONCE_FROM_FUTURE`, `UNAUTHORIZED_SIGNATURE_INVALID`, `UNAUTHORIZED_PUBLIC_KEY_INVALID`, `UNAUTHORIZED_ACCESS_KEY_NOT_FOUND`, `UNAUTHORIZED_NOT_FULL_ACCESS_KEY`, `VERIFY_RPC_ERROR` — instead of a single blanket "Invalid signature", and the client propagates those codes to `onError` callbacks.
