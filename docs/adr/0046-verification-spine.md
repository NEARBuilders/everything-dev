# 0046 — The verification spine

Date: 2026-11-09 · Status: proposed

## Context

The runtime's distribution chain is a sequence of content-addressed claims:

```text
chain tx ────▶ config pointer ────▶ release record ────▶ slot version manifest ────▶ version dir ────▶ file
(signed)      (fingerprinted)      (thin tag, burned)    (SRI-pinned, dir-scoped)    (write-once)    (sha384)
```

Every layer is the same concept — an identity attests that some bytes hash to
some digest, and a consumer verifies one hop before trusting the next — but the
code represents it as twelve-plus bespoke verifiers across nineteen files
(`fetchVerifiedManifest`, `verifyRollbackSnapshot`, `verifySriForUrl`, the
`IntegrityRegistry`, SnapshotWatch's integrity monitor, the adopt legs, tenant
override checks, compose parity, the smoke gate, federation compat checks, the
train's truth gates, `bos verify`) and six digest identities over overlapping
inputs (`pointerFingerprint`, `deploymentFingerprint`, the compose variant
fingerprint, the compose digest, the lockfile digest, and the new version-`dir`
id). The fingerprint module's own header records the semantic merge of its two
hashes as "a future seam."

The cost is not aesthetic — each recent incident in this family is a symptom of
a forked representation:

- **The dead SRI gate (#642).** Two verification representations drifted: the
  integrity registry keyed by the fixed-name entry URL while the runtime fetches
  the hashed one, and the hook was never installed because the probe reached for
  an instance property that does not exist. A single verification engine keyed
  by resolved URL cannot fork this way.
- **#826 (rotting pins).** The immutability contract was represented in three
  places — hashed filenames, in-place uploads, cache-control classification —
  that disagreed; fixed-name files were overwritten under pins that promised
  forever. The fix (version directories, write-once enforcement) collapsed the
  representation for storage; the *verification* side still has twelve owners.
- **`ComposeDigestMismatchError`.** The compose manifest was read from the
  mutable slot root while the engine loaded pinned bytes — two layers reading
  the same artifact from different generations. The parity guard caught it, but
  only because the representation had forked enough to need a guard at all.

Separately, the chain has an **authenticity** asymmetry the integrity checks
cannot close: registry writes are NEAR-signed and action-indexed (on-chain
auditable), but CDN objects carry only content hashes. SRI answers "are these
the bytes the pin names," never "did the account that owns this runtime publish
them." The upload path is API-key *authorized*, not cryptographically
attributable after the fact — the first write of any key trusts the upload
service's authorization alone.

## Decision

1. **One verification engine.** A `Verifier` service (an `everything-dev`
   module consumed by the CLI and the host) with a single implementation of
   fetch → hash → compare → named-failure, returning `Verified` artifacts.
   Every bespoke verifier becomes a call with different inputs and the same
   engine; the error taxonomy collapses to yieldable tagged errors —
   `IntegrityMismatch`, `ProvenanceUnknown`, `SignatureInvalid` — the #642
   named-error wish, arrived at structurally.
2. **One chain walker, parameterized by depth.** `verifyChain(config, depth)`
   walks the spine: `pointer` (the config's pins resolve and their documents
   verify), `entries` (plus the pinned entry bytes), `files` (plus every file
   the manifests name). `bos verify` is a thin CLI over `files`; the smoke
   gate, the adopt transaction, and the publish truth gates call the same
   walker at shallower depths instead of hand-rolling their subsets.
3. **Digest identity consolidation.** One derivation module producing the
   composition identity — `pointerFingerprint` and `deploymentFingerprint`
   merge (the recorded seam), and every other digest derives from it or is
   renamed to say what it is.
4. **`Verified<T>` as a branded type.** Artifacts that have passed
   verification are branded values; downstream consumers take `Verified<T>`,
   so unverified bytes cannot flow into composition by accident. The type
   system carries the layer collapse.
5. **Signed manifests for distribution.** The deploy train signs each slot's
   version manifest with the runtime's publish identity (the publish key or
   custody wallet it already holds). The public verifying key rides the
   on-chain config — already signed territory, so rotation is a config
   publish. Signatures cover the canonical manifest bytes; individual files
   stay unsigned (they are already content-addressed under the manifest).
   The chain walker verifies attribution at every depth, making the CDN layer
   self-authenticating: "these bytes were published by whoever controls
   `dev.everything.near`," not merely "these bytes match the hash the config
   names."

## Consequences

- Every future integrity incident fixes in one place. The next dead-gate class
  — a verifier whose keying or reach silently drifts — becomes structurally
  impossible: there is one engine, one keying rule.
- The lifecycle reads as a spine of attestations: init resolves the chain,
  deploy extends it (signed), serve re-verifies it (watch, adopt, compose
  parity), verify audits it end to end, rollback re-publishes a verified
  prefix. Documentation and `GLOSSARY.md` adopt the vocabulary.
- Signed manifests add a schema field (additive — legacy manifests verify
  integrity-only while the rollout completes) and a key-record convention in
  the authored config. Consumers without signature support keep working;
  consumers with it gain attribution.
- Migration is opportunistic, not a flag day: new code uses the engine; each
  legacy call site moves when touched, and #642's revival lands *as* a
  migration (the hook becomes an engine consumer keyed by resolved URLs).
- What this does **not** do: collapse the storage artifacts (thin tags,
  version records, slot manifests, directories each earn their layer), sign
  individual files, or rewrite the deploy train's async core in Effect for
  purity — the handler boundary already bridges, and the deliverable is the
  shared engine, errors, and types.

## References

- #826 — parent republishes overwrite fixed-name bundle files (the rot; fixed
  by version directories, PR #828)
- #642 — `bos verify` chain proof + the dead entry-SRI gate (revival lands as
  an engine migration)
- #574 — slot-first pin resolution, old pins resolvable forever
- #546 — shared-singleton skew (the composition guard that inspired the
  named-error taxonomy)
- ADR 0001 — action-indexed registry writes (the chain layer's attestation)
- ADR 0034 — release composition and the thin-tag/version-record split
- ADR 0042 — the composition lockfile (a digest identity to consolidate)
- PR #828 — version directories, `bos verify`, the drift alarm
