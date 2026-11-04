# 0043 — The two-plane boot: the control plane produces, the application runtime consumes

Date: 2026-11-04
Status: Accepted (the crossroads design; the staging leg ships in the lockfile sprint's final slice)

Lineage: [ADR 0041](./0041-boot-snapshot.md) (the approved boot snapshot — restarts never resolve), [ADR 0042](./0042-composition-lockfile.md) (the composition lockfile — the frozen exact composition), [ADR 0040](./0040-registry-wire-cutover.md) (the wire the control plane writes), [ADR 0021](./0021-universal-runtime-image.md) (identity-driven boot), [ADR 0035](./0035-deploy-console-hosting-adapter.md) (the hosting adapter — where remote-tier staging lands), plan 043 (the bundle cache is a resilience artifact, never a deployment).

## Context

Two sprints shipped the halves of one contract without naming it. The approved boot snapshot (ADR 0041) gives restarts a verified serving state — but the boot still resolves first and falls back only on outage, and nothing writes the snapshot for a deployment that hasn't booted yet. The composition lockfile (ADR 0042) gives CI and the boot a composition identity — but nothing stages it, and the boot still re-derives remote coordinates from mutable upstream state when the registry is reachable.

The architecture review's §6 names the shape these halves converge on: **discovery and execution are separate phases**. The control plane — the registry as the activation and provenance channel, the deploy train and CI as the producers — resolves, verifies, authorizes, and *produces deployment snapshots*. The application runtime starts from an approved, digest-verified artifact, serves traffic, and converges on newer activations in the background. The registry being down must shrink from "boot fails" to "fresh hosts wait; restarts serve the staged state; running hosts keep serving."

## Decision

**1. Two planes, explicit.**

- **Control plane** — produces and activates: the registry wire (config, thin tag, version records, deploy records — activation + provenance), the deploy train and CI (build → verify → publish → **stage** → promote), the gates (`bos lock --check`, smoke, sentinel, drift alarms).
- **Application runtime** — consumes: starts from a digest-verified approved artifact, serves, reports health and active composition, and converges on newer activations through the pointer watch. The registry is a *background freshness channel*, never a boot dependency for restarts. Fail-loud survives for **fresh activations** — a host that has never verified anything and cannot reach the registry still refuses, exactly as today.

**2. The boot contract (the precedence order is unchanged; the roles are now named).**

1. `--config-path` — the operator's declared truth; the watch is off; no snapshot interaction.
2. **Registry identity** — a fresh host resolves once and *persists* (ADR 0041's writer seam); a restart during an outage serves the staged snapshot, degraded and visible.
3. **Staged snapshot** — written by the control plane *at activation* (new, below) or by the host on adopt/cold-resolve; restarts read the staged state first-verify-then-serve, and the registry call becomes a background freshness check through the watch (which is already the convergence mechanism).

**3. Staging is a train leg (the implementation slice of this ADR).** Post-confirm, the deploy train writes the approved snapshot for the runtime it just published — the same writer seam, `bootSnapshotOf` over the exact publish payload, stamped with the release thin tag when the release leg ran and with the lockfile digest (below). Single-box self-hosted runtimes get "restarts never resolve" immediately: the staged state IS the composition the train just verified and published. Remote tiers stage through the hosting adapter (ADR 0035) — recorded seam, not built.

**4. Authorization escalation: the snapshot carries the lockfile digest.** `BootSnapshotSchema` gains an optional `lockfileDigest` — the train stamps it from the staged lockfile (ADR 0042 ticket 04's digest), and the deployment record named the same digest (ticket 04). Enforcement (the rung *requiring* the match when the runtime's own lockfile exists) ships later; the identity ships now. Strict-schema tradeoff, accepted at rc per the ADR 0040 posture: a snapshot written by a newer host carries a key an older host's strict reader refuses — that window is a deliberate downgrade, and the refusal is loud with the registry as the recovery path.

**5. Fresh activations stay fail-loud.** No staged state, no registry → `StartFetchFailed`, unchanged. The rung serves *restarts of approved generations*; it is never a substitute for discovery, and the sentinel (nightly cold-cache) plus the smoke gate (healthy boots must carry no snapshot provenance) remain the detectors for the rung silently becoming the norm.

## Consequences

**Positive.**

- Restarts of staged deployments never resolve — the review's end state, reached by composing the two shipped halves rather than a new mechanism.
- The registry outage's blast radius shrinks to its true scope: fresh hosts wait, watch convergence pauses, nothing serving degrades.
- The staging leg reuses the snapshot's writer seam — one artifact, one verification contract (fingerprint recomputation), one lifecycle (last verified generation per runtime).

**Negative / accepted costs.**

- Staging lifecycle grows one writer: the train writes at activation, the host re-writes on adopt — last verified generation wins, bounded at one file per runtime (unchanged from ticket 02).
- The strict-reader downgrade window (decision 4) refuses loudly rather than stripping — consistent with the cutover's no-alias posture.
- Remote-tier staging (hosting adapter) is future work; until then, remote restarts keep the ticket-02 behavior: resolve on boot, snapshot on outage.

## References

- Implementation slice: the train's staging leg + `lockfileDigest` on the snapshot (composition-lockfile sprint, crossroads slice).
- Sprint ledgers: `.scratch/boot-snapshot/` (tickets 01–04, done), `.scratch/composition-lockfile/` (tickets 01–05, done).
- The review's §6 (control plane vs application startup) and §2 (the lockfile as the resolution authority).
