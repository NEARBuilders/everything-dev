---
"better-near-auth": patch
---

Switch the wallet connector from `@fastnear/near-connect` back to the `@hot-labs/near-connect` lineage, installed from the gas-key-capable fork `elliotBraem/near-connect#v0.12.0-fork.2` (github tag). The fork natively provides gas-key actions (`AddKey` with `gasKeyInfo`, `TransferToGasKey`, `WithdrawFromGasKey`), the `features.gasKeys` manifest flag, `cspNonce` sandbox support, and the iframe dispose guard that previously had to be restored via a tracked patch — `patchedDependencies` and the patch file are dropped, and near-kit's `fromNearConnect` peer typing is satisfied directly. No API surface changes.
