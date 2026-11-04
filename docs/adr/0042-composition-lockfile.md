# 0042 — The composition lockfile: one frozen composition, everything derived

Date: 2026-11-04
Status: Accepted (ticket 01 of the composition-lockfile sprint)

Lineage: [ADR 0040](./0040-registry-wire-cutover.md) (the wire the lockfile freezes — `RemoteDescriptor` shape, thin tag, version records), [ADR 0034](./0034-platform-release-manifest.md) (release-scoped remotes the lockfile inherits), [ADR 0001](./0001-fastkv-registry-namespace-signer.md) (registry writes).

## Context

The exact executable composition of a runtime is currently spread across seven artifacts, each authoritative for one consumer and none consumable by boot:

| Artifact | Role | Limitation |
|---|---|---|
| `bos.app.ts` | Authored intent | Deliberately unresolved |
| `.bos/bos.resolved-config.json` | Materialized at deploy | Gitignored, not a boot identity |
| Version-record `remotes:` | Platform-release pinned composition | Platform-level only; a leaf's own remotes are outside it |
| `.bos/deploy-state.json` pins | Deploy-diff bookkeeping | Not consumed at boot |
| `.bos/generated/runtime-map.json` | Composition explainer | Generated independently — can drift from what boots |
| `deploys/<ts>.json` `DeployRecord` | Registry-side audit | Names remotes, not as a boot input |
| `pointerFingerprint` + `deploymentFingerprint` | Two identity hashes | Two implementations of "same composition?" |

At every cold boot the host re-derives the composition: extends-merge over the live parent pointer, release stamping, config walking (`resolvePublishedConfig` → `walkExtendsChain` → stamp). Reproducibility is a property of the *resolution machinery*, not of any artifact an operator can inspect, diff, or pin. The architecture review's §2 names the consolidation constraint this ADR adopts: **don't add a lockfile as one more authority — consolidate.**

## Decision

1. **`bos.lock.json`, at the app root beside `bos.app.ts`, committed.** Derived, never hand-edited. `bos lock` resolves the authored config through the full extends chain + release stamping (today's producer machinery) and freezes the result; `bos lock --check` is the CI drift gate (lockfile vs re-resolution). The wire schema is the `everything-dev/lockfile` subpath.

2. **The schema reuses the release manifest's remote-descriptor shape verbatim** (`{base, digest: {manifest, integrity}}` — ADR 0040's `remotes:` entry shape; a different shape would be a second vocabulary for the same bytes). Fields: schema version + kind, the runtime ref, the release the composition resolves to (absent = unpinned/channel — the lockfile still freezes what channel resolution *returned*), the per-remote digest map keyed by dotted config path, shared-singleton versions, per-remote contract hashes, the composition fingerprint, and `resolvedAt`. **The lockfile's fingerprint is THE composition identity**: `pointerFingerprint` semantics move here, the host's `deploymentFingerprint` unifies onto it (ticket 04) — one hash, computed by host and CLI alike.

3. **Two producers, one format.** `bos lock` (explicit, operator-invoked channel resolution) and the deploy train (writes the lockfile for what it just published, so repo state and live state agree). The runtime map generates FROM the lockfile — the explainer cannot drift from the frozen composition, because it has no other input.

4. **Boot consumes the lockfile when present.** A registry-fetched boot reads `bos.lock.json` and composes from it directly — zero extends-walk resolution on the boot path. The extends-merge + release-stamping machinery remains exactly where it is: the lockfile's *producer* path. Absent lockfile → today's behavior, unchanged. Strictly additive: deleting the file regresses to the current boot.

5. **The DeployRecord names the lockfile digest.** A deployment record then answers "what exact composition was live" — which makes `bos promote` and rollback activations of a recorded lockfile (deploy-hardening Phases 3 + 5 fold into ticket 05).

6. **Relation to version records — same shape, different scope.** The platform release manifest's `remotes:` is the *platform's* per-release memory of inherited slots; the lockfile is *this app's* frozen whole composition (own + inherited). They agree by construction for pinned children: the lockfile derives through the release stamp, so its inherited entries carry the release's recorded digests.

## Consequences

**Positive.**

- One identity hash, one frozen composition, no re-derivation at boot — the review's "load a resolved composition, don't rediscover it".
- The runtime map, deploy diff, and DeployRecord all read from the lockfile; the drift class "explainer says X, boot composed Y" closes structurally.
- Reproducibility becomes inspectable: `git diff bos.lock.json` is the composition changelog, reviewable in PRs like a pnpm lockfile.

**Negative / accepted costs.**

- One more file in every app root — derived but committed (the whole point is diffable composition history); `bos lock --check` is the enforcement that it stays fresh.
- Lockfile-vs-live-pointer divergence becomes the new drift surface: gated by `--check` in CI and by the train's post-publish write. The lockfile never *overrides* the registry — it is an input, and staleness fails the check, not the boot.
- Contract-hash and shared-singleton fields start optional (recorded when the sources provide them — remote plugin manifests, the release manifest) and tighten as producers mature; the schema version exists for exactly that migration.

## References

- Sprint: `.scratch/composition-lockfile/` (tickets 01–05).
- Implementation: `packages/everything-dev/src/services/lockfile/schema.ts` (wire schema); producer and boot-consumer tickets follow.
- [ADR 0040](./0040-registry-wire-cutover.md) for the descriptor shape and the digest chain the lockfile's entries point into.
