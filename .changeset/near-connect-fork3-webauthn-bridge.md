---
"better-near-auth": patch
---

Adopt nearConnect fork.3 (`elliotBraem/near-connect#v0.12.0-fork.3`): the sandbox now bridges `webauthn.create`/`webauthn.get` for permission-declared wallets (the missing host-library prerequisite for the immutable-pinned passkey executor, PR #621), and wallet sign-out no longer wipes the sandbox storage space (the version-keyed executor cache and gas-key bootstrap material survive sign-out). The passkey wallet manifest declares the new `webauthn` permission so the bridge opens for our executor.
