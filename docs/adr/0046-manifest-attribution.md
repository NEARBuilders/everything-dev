# 0046 — Manifest attribution (signed version manifests)

Date: 2026-11-09

## Context

SRI is integrity, not attribution. Registry writes are NEAR-signed (on-chain, auditable), but CDN objects carry only content hashes and the upload path is API-key authorized — the first write of any key trusts the upload service's authorization alone. A compromised storage credential can publish bytes into a namespace between the on-chain attestation and the bytes consumers load: the chain is verifiable at the registry layer and hash-verifiable below it, but not attributable below it. (Verification-spine ticket 05; the sprint's decision 5.)

## Decision

**What is signed.** Each slot's `versions/<hash>.json` version manifest. The payload is `signaturePayloadOf(document)` — the document minus its reserved `signature` field, serialized with `stableStringify` (key-sorted, `undefined`-dropped), the **same canonicalization the version-id derivation hashes**. The stored document's whitespace never matters: the signer signs the canonical payload before the field exists; the verifier re-derives it from the parsed document. `signature` is excluded from the version id like `builtAt` — it is not a coordinate of the build (in fact it never enters `VersionManifestInput` at all; signing happens after `composeVersionManifest`, before serialization). Files stay unsigned — they are content-addressed under the manifest.

**The signature block.** `{ algorithm: "ed25519", publicKey, value }` — `publicKey` is the NEAR-format verifying key (`ed25519:<base58>`), `value` is base64 over the 64-byte signature. The key rides along so a verifier can distinguish *wrong signature* from *signed by a key the config never registered*; both are the tagged `SignatureInvalid` (verify-engine, ticket 01) and both are hard failures.

**Who signs.** The deploy train, at pin time (`pinWorkspaceVersionManifest`), with the runtime's existing publish identity — no new key material:

- explicit publish key: `resolveSigningKey` (env `NEAR_PRIVATE_KEY` / `BOS_NEAR_PRIVATE_KEY` / keychain credentials), signed via near-kit;
- custody (`publish.auth: "custody"`): the OutLayer coordinator's `signMessage` (`format: "raw"`) with the TEE-held wallet key — the same key that signs the registry write.

The signing identity must equal the config's key record; a mismatch fails the train **before anything uploads**. The record and the signer drifting apart is exactly the attribution gap.

**Key record.** The authored config's publish section gains
`publish.verification: { publicKey } | "off"` (absent ≡ off — the rollout default). It publishes inside the on-chain config (publish canonicalization touches only `development` targets), so the record inherits chain authenticity and **rotation is a config publish** — never a silent key swap. Consumers resolve: config (chain-signed) → public key → manifest signature → bytes. Children inherit via `extends`.

**Who verifies.** The chain walker, at every depth, before any integrity check is reported: the signature leg is **distinct from the SRI legs** (`VerifyRemoteResult.signature`), and a failure is a hard failure for the chain — `bos verify` exits nonzero, the smoke gate and the adopt transaction refuse the composition. The integrity legs still run and report, so a rotated key record shows exactly what stayed sound. Unsigned manifests under attribution-off verify as today (old CLIs strip the unknown field).

## Consequences

- A storage-credential compromise can no longer serve bytes a reader accepts without either (a) the config's key record naming the attacker's key — a chain-signed, auditable config change — or (b) a signature forgery.
- Rollout is additive: attribution-off everywhere today; the parent flips it on for its own slots, children inherit.
- The `bos verify` report and the deploy workflow's smoke step grow the attribution column; `formatChainFailures` renders signature failures as their own lines.
