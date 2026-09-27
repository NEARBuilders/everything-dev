---
"better-near-auth": minor
---

Vendor better-near-auth into the monorepo at packages/better-near-auth and bump to a minor release: add ML-DSA-65 (post-quantum) NEP-413 signature verification for passkey-derived NEAR keys, move to near-kit ^0.19.0 APIs (fromNearConnect, InMemoryKeyStore, parseKey), add optional react peer dependency with nanostores-backed react/store entrypoints, and expose `development` export conditions so workspace consumers typecheck and build against src.

The package is now published from this repo via changesets (repository/bugs/homepage point at NEARBuilders/citynode.app).
