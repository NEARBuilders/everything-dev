# 0041 — The approved boot snapshot: restarts never resolve

Date: 2026-11-04
Status: Accepted (ticket 01 of the boot-snapshot sprint)

Lineage: [ADR 0040](./0040-registry-wire-cutover.md) (thin tag + immutable version records — the snapshot's authorization facts), [ADR 0021](./0021-universal-runtime-image.md) (identity-driven boot), plan 043 (the bundle cache is a resilience artifact, never a deployment).

## Context

The host's serving path is already snapshot-gated: `RuntimeSnapshot` (fingerprint + config + pointer + serving caches) is held in an in-memory `Effect.Ref` (`host/src/services/runtime-snapshot.ts`); the coordinator adopts a new generation only after extends-walk + verification (the chain walker — [ADR 0046](./0046-manifest-attribution.md) owns the verification mechanics this ADR consumes; the adopt fingerprint is the deployment digest), a failed adopt leaves the live snapshot untouched, and the swap under traffic is atomic (`snapshot-coordinator.ts`). A pointer watch (30s default) detects published changes (`snapshot-watch.ts`). The runtime never re-resolves per request.

But the snapshot dies with the process. Cold boot is identity-driven and fail-loud (`start/boot.ts` → `resolvePublishedConfig` → `StartFetchFailed`), so a restart during a registry or CDN outage refuses to serve — even though this host provably served that exact composition minutes ago. The knowledge of "the last verified generation" exists only in memory and evaporates on every restart.

The bytes plane already drew the right line: `BOS_BUNDLE_CACHE_DIR` keeps last-known-good bundle bytes as a resilience artifact, explicitly never a deployment (plan 043). The composition plane has no equivalent — there is no persisted record of *which composition* the host last verified, so a restart cannot even name what it would degrade to.

## Decision

1. **The approved snapshot is a persisted, verified serving state.** Written atomically (temp + rename) by one seam on every successful adopt, and by the boot path when it resolves the registry cold. The file lives under `.bos/snapshot/<account>/<gateway>.json` (root overridable via `BOS_SNAPSHOT_DIR`; a separate root from `BOS_BUNDLE_DIR` and from the bundle cache — plan 043's never-point-at-another-runtime's-layout rule carries over). Content: schema version + kind, the runtime ref (`bos://<account>/<gateway>`), the manifest tag `{version, digest}` that authorized it, the pointer fingerprint, the resolved published config (`BosConfig` — schema-parsed on load, and the loader re-derives `RuntimeConfig` from it deterministically, so env-derived fields are never persisted), the per-remote digest map, the deploy-record key, and `writtenAt`. The schema and path helpers are the `everything-dev/snapshot` subpath — shared by host (write/load), CLI smoke, and the sentinel.

2. **Boot source precedence gains one rung: config-path > registry identity > snapshot.** The snapshot rung applies only when the identity is set and resolution fails *transiently* — unreachable registry, timeout, 5xx. A definitive negative (runtime not found, schema-rejected bytes) is a state change, not an outage: it fails loud exactly as today. Loading a snapshot verifies it *without the network*: schema parse, pointer-digest re-derivation from the stored config must match the stored hash (mismatch = refuse, loud; the digest vocabulary is [ADR 0046](./0046-manifest-attribution.md)'s). Network-dependent SRI re-verification stays in the serving path, where the bundle cache covers byte fetches. The snapshot guarantees "the composition this host last verified", not fresh bytes — honestly stated, never oversold.

3. **Degraded, visible, converging.** A snapshot boot reports its state on the health surface and in logs (naming the snapshot and its `writtenAt`), and the pointer watch stays ON: the moment the registry returns, normal adoption resumes and the degraded state clears. Degradation is a runtime state, not a config mode.

4. **Default posture: persist default-on for identity-driven boots; boot-from-snapshot default-on with a kill switch.** `BOS_SNAPSHOT_BOOT=never` restores strict fail-loud for operators with freshness requirements. Config-path boots are untouched — their mounted config is already declared truth (and already disables the watch).

5. **Freshness is explicit.** The snapshot is stamped evidence of the last verified generation — tag version + `writtenAt` on every read path. Adoption on registry return is the freshness mechanism; the snapshot never silently promotes itself to "current".

## Consequences

**Positive.**

- Restarts survive registry and CDN outages (composition from the snapshot, bytes from the bundle cache) — the review's §6 split of discovery (control plane) from execution (application runtime), realized incrementally.
- The sentinel (registry-primitive ticket 12) already exercises the cold path nightly; ticket 04 extends it to assert snapshot recovery.
- One writer seam and one file per runtime; retention is trivially bounded (last verified generation, overwritten on adopt).

**Negative / accepted costs.**

- During an outage, a restarted host serves the generation it already served — possibly older than the registry's live pointer. This is bounded by construction (never older than what this host verified) and visible by construction (health + logs). Strict-freshness operators use the kill switch.
- Disk state with a lifecycle: one small JSON per runtime; a corrupt or fingerprint-mismatched file is refused, not repaired.
- The fingerprint stored is the pointer fingerprint (`registry/fingerprint.ts`); the host's `deploymentFingerprint` (entry-URL hash) is a second identity that ticket 04 of the composition-lockfile sprint unifies — until then the snapshot carries the config, from which both are derivable.

## References

- Sprint: `.scratch/boot-snapshot/` (tickets 01–05).
- Implementation: `packages/everything-dev/src/services/snapshot/schema.ts` (wire schema + paths), ticket 02+ wires the coordinator and boot path.
- [ADR 0040](./0040-registry-wire-cutover.md) for the manifest tag and version records the snapshot's authorization facts come from.
