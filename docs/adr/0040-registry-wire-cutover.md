# 0040 — The registry wire cutover: thin tag + immutable records, and the slot→remote vocabulary

Date: 2026-11-03 (ticket 10 implementation merged in #764; ticket 11 codifies the vocabulary and supersedes the last 0034 vocabulary remnants)
Status: Accepted
Supersedes: the vocabulary and pointer-home decisions of [ADR 0034](./0034-platform-release-manifest.md) (the `platform.json` pointer slot and its amendment-era "slot" naming). 0034's *release-manifest* decision itself stands — only its wire home and vocabulary are superseded.
Lineage: [ADR 0001](./0001-fastkv-registry-namespace-signer.md) (namespace=signer, action-indexed writes), [ADR 0036](./0036-three-pin-planes.md) (cross-plane verification).

## Context

Through rc.36 the registry's release surface was one moving key: `apps/<account>/<gateway>/platform.json` held the **entire** platform release manifest, republished in place on every root deploy. That shape had three structural problems:

1. **No immutability.** A pinned child recorded a *version string*, but the bytes it resolved could change under it at any root republish. The "#546 stale-pin window" and the "Nov-03 burned slot" incident are the same failure: a pin that names bytes nobody can serve anymore, discoverable only after a boot skew.
2. **Untyped keys.** Every reader and writer hand-built FastKV path strings (`platform.json`, `deploys/<ts>.json`, …) — a driftable copy of the wire layout per module, exactly the failure mode [ADR 0032](./0032-framework-owned-files.md) names for constants.
3. **Vocabulary drift.** The config's remote positions were called "slots" everywhere — colliding with the descriptor domain's attachment slots, the infra domain's port slots, and FastKV's own key-slot language — while the thing a pin actually points at (a versioned manifest document) had no name at all.

## Decision

**1. A typed key model owns the wire.** `registry/keys.ts` declares the closed `RegistryKey` union — `runtimeConfig`, `manifest`, `version`, `deployRecord` — and `keyPathOf` is the one derivation of the exact FastKV key string. Consumers never hand-build registry paths; golden tests pin the wire forms. `parseRuntimeRef` is the only `bos://<account>/<gateway>` parser (the former `parseBosUrl` adapter is deleted; callers use the typed parser).

**2. The release surface is a two-level digest chain.**

- `apps/<account>/<gateway>/manifest.json` — a **thin tag**: `{ schemaVersion, version, digest }`. It is the *moving pointer*, atomically overwritten on every release leg. `digest` pins the exact bytes of the record, so a tag read verifies what it is about to name.
- `apps/<account>/<gateway>/versions/<v>.json` — the **immutable record**: the full platform release manifest for that framework version, written once and never republished (the immutability check refuses a divergent write — a burned version stays burned, loud).
- `apps/<account>/<gateway>/deploys/<ts>.json` — the per-deploy audit trail (one record per publish, newest-first for `bos deploy --status`).

Resolution reads the thin tag, verifies its digest, then reads the named version record. Pin-first ("record-first") resolution resolves a pinned child from `versions/<v>.json` directly — permanent, cache-independent. Unpinned resolution follows the chain's tag. The offline cache (`.bos/manifest.json`) remains an offline aid only, TTL-bounded, never stale-pin grace.

**3. The cutover is strict and no-alias.** `CUTOVER_RELEASE` (2.0.0-rc.37) is the compat floor: resolution rejects a pre-cutover chain entry loud ("the runtime you extend publishes a pre-cutover composition — it must redeploy on ≥ rc.37"). There is **no dual-read and no legacy parser** — a full (pre-cutover) manifest found at the tag home is a rejection, not a fallback. Older CLIs fail loud until `bos upgrade`. The old `platform.json` key is abandoned in place — never read again, never migrated.

**4. Rollback across the cutover is deliberately unrestorable.** A rollback to a pre-cutover snapshot cannot serve: the old key is gone and the old parser is deleted. The pin-verification gate (every pinned remote's manifest must serve and match its SRI — atomic-deploys 11) plus `bos upgrade` are the recovery paths; `bos upgrade --check`'s drift alarm is the catch for a chain that moved past a pin. We accept this: keeping a pre-cutover read path would preserve the exact ambiguity the cutover exists to remove.

**5. Vocabulary: a config position is a *remote*, a pin target is a *record*.** Ticket 11 completes the sweep ticket 09 began, with strict no-alias renames (rc stage tolerates the break; the API contract field renames ship without aliases):

- `slot` → **`remote`** everywhere it names a config position: the `Remote` walker property, `RemoteDescriptor`, `RollbackRemoteCheck`, `UiCompositionRemote`, `ReleaseRemoteRef`, `entryUrls(remote, …)`, the federation/rollback/mf-check report fields (`slots` → `remotes`), the `/.well-known/version` response field, and the CLI render surfaces.
- `slotPins()` → **`remoteDigests()`** (the same rename on the publish payload, the deploy result contract, and the version endpoint), and `collectReleaseSlotPins` → `collectRemoteDigests`-shaped names.
- provenance `"slot"` → **`"record"`** — the enum is now `z.enum(["record", "pointer"])`, aligning the wire with the `versions/<v>.json` record vocabulary.
- `resolveSlotVersion`/`clearSlotVersionCache`/`ResolvedSlotVersion` → `resolveRemoteVersion`/`clearRemoteVersionCache`/`ResolvedRemoteVersion` (the published `everything-dev/version-manifest-resolve` subpath keeps its name; only the exported functions rename).

Out of scope, kept as-is: the descriptor domain's *attachment slots* (`SLOT_INPUT_FIELDS`, `LocalWorkspaceSlot`), the infra planner's port slots, shadcn's `data-slot` attributes, and test fixtures' user variables named `SLOT`. These are different concepts; folding them in would blur the boundary this ADR just sharpened. Their alignment, if ever wanted, is a separate vocabulary pass.

## Consequences

**Positive.**

- Pins become verifiable identities: a child can prove the bytes it resolves are the bytes its release published (digest chain + SRI), and a missing record fails loud at resolution instead of skewing at boot.
- The wire layout is provable from one module; golden tests fail on drift instead of production.
- "Remote" names the thing every consumer already meant; "record" gives the pin target a noun, and `manifest.json`/`versions/<v>.json`/`deploys/<ts>.json` read as what they are.

**Negative / accepted costs.**

- The API contract field renames (`slotPins` → `remoteDigests`, `slots` → `remotes`, provenance `"slot"` → `"record"`) break external readers of the deploy results, the mf-check/upgrade reports, and `/.well-known/version` — no aliases, accepted at rc stage.
- Published-package consumers importing `resolveRemoteVersion`-family names from rc ≤ rc.36 fail loud until they bump and rename.
- Pre-cutover snapshots are unrestorable by design (see decision 4); the drift alarm and pin verification are the catches.
- Old registry keys (`platform.json`) are dead weight on the wire — abandoned in place, never cleaned up.

## References

- Implementation: `packages/everything-dev/src/services/registry/keys.ts` (key model), `registry/pointer.ts` (wire keys), `registry/resolution.ts` (the machine), `platform/manifest-schema.ts` (`ManifestTag`, `CUTOVER_RELEASE`), `deploy/platform-manifest.ts` (the two-key publish entry).
- Sprint ledger: `.scratch/registry-primitive/` (tickets 09–12).
- [ADR 0034](./0034-platform-release-manifest.md) for the release-manifest content model this wire serves.
