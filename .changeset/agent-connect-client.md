---
"better-near-auth": minor
---

Add `signAgentIntent` to the client surface (`better-near-auth/client`): signs a generated Agent Connect owner intent byte-for-byte with the connected wallet — `nep413` via signMessage, `nep366` via signDelegateActions, `webauthn` via the passkey authenticator — returning the wallet's output for the caller to submit. The agent-account control plane itself moved out of this package into the new `@everything-dev/agent-connect-plugin`.
