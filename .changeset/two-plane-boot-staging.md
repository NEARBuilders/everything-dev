---
"everything-dev": minor
---

The two-plane boot, staging leg (ADR 0043): the deploy train now writes the approved boot snapshot for the composition it just confirmed live — stamped with the release thin tag (when the release leg ran) and the lockfile's content digest — so restarts of the published runtime boot from the staged state instead of resolving. Non-fatal like every provenance leg. `everything-dev/snapshot`'s `bootSnapshotOf`/`BootSnapshotSchema` gain the optional `lockfileDigest` staging stamp (the identity tying an approved generation to the deployment record that named it — enforcement deferred; the strict-reader downgrade window is accepted per the ADR 0040 posture). The ADR names the contract: the control plane (registry + train + CI) produces and activates; the application runtime starts from a digest-verified artifact, converges through the watch, and stays fail-loud for fresh activations. Remote-tier staging rides the hosting adapter later (recorded seam).
