# ADR 0035: The deploy console — one thin hosting adapter, substrate-independent state

Date: 2026-10-21
Status: Proposed

Depends on: ADR 0001 (FastKV registry — public reads, action-indexed writes), ADR 0020/0021 (universal runtime image, identity-driven boot), ADR 0034 (platform release manifest), ADR 0036 (three pin planes — the console's integrity surfaces operate on the image and bundle planes and must not weaken the config plane's verification). Shares lineage with plan 032's locked decision ("the platform image on alchemy-managed machines; children never ship Dockerfiles") and resolves its open machine-provider question.

Implements the design session for [issue #526](https://github.com/NEARBuilders/everything-dev/issues/526).

## Context

The per-child Railway deploy leg holds a long-lived `RAILWAY_TOKEN` that is only exercised on release-train bumps, mutates the live service source imperatively in CI, and runs *after* the FastKV publish — so its failure (2026-10-21, feedback.nearbuilders.org: an invalidated token surfaced as "Unauthorized" only after the config publish) leaves production serving a mismatched config/image with no diff, no drift signal, and no review trail. Separately, Railway reliability has become a platform-level concern: the root runtime — which every shared-host tenant rides on — is hosted there too.

The operator's direction from the design session: stop treating hosting as per-child CI plumbing and make the platform's own app the deploy console — a deploys list (from on-chain history), rollback buttons, and surfaced logs for investigation. Platform custody of child Railway tokens was considered and **rejected** (wrong trust boundary: a third party holding child-owned infra credentials, plus a credential store and relay service to operate). Variants that merely relocate the credential were rejected for the same reason.

## Decision

1. **The console's data is substrate-independent, so it never depends on the hosting provider.** Deploy history reads the per-deploy audit manifests already published to FastKV (public reads — root and every child, zero credentials). Config rollback reuses the existing verified-snapshot flow (`rollbackToPreviousSnapshot`: pinned-slot SRI verification, refuse-don't-half-execute, `rolledBackFrom` stamp, registry entries on one atomic write). Logs ship to a neutral sink (Axiom) rather than living in the substrate. The console composes these; no hosting API is involved in listing or in the config half of rollback.

2. **One thin `HostingAdapter` is the only substrate coupling** — `deploy(image, identityEnv)` / `current` / `restart` / `stop`, returning a URL. No substrate specifics (ports, networks, machine ids) cross the seam. Substrate lineup, in order: **Docker** (Alchemy Docker provider over a local/SSH docker context) as the development and CI substrate; **Railway** (Alchemy Railway provider, adopting the live service) as the production interim; **Fly** (Alchemy Fly provider, raw `image@digest` Machines) as the destination. The swap is a wiring change behind the seam, not a rearchitecture. Alchemy is the **only** control plane: all stacks share one state ledger (`Cloudflare.state()`).

3. **The rollback unit is FastKV-first.** A console rollback is not "restart with the previous image": it re-publishes the previous verified snapshot (config + manifest pins, SRI-checked, refusing outright on any verification failure), then restarts the instance against the rolled-back pin. Shared-host `*.<root>` tenants skip the instance half entirely — per-request config resolution makes the FastKV half the whole rollback, instantly. A failed instance half leaves the config rolled back and surfaces a drift marker.

4. **The reconciler makes publish the deploy.** A platform-side watcher converges platform-hosted instances to each namespace's latest published fingerprint via the adapter — idempotent, failures surfacing as drift. This dissolves the child Railway leg, the per-child token, the custody question, and any relay trigger in one move: a child's deploy action is publishing its config.

5. **Tier map on the destination substrate.** Root: a redundant Machine pair behind one anycast (migrates first — it is the acute outage pain). Shared-host tenants: no machine, unchanged. Own-instance children: auto-stop Machines + volumes on the platform's account (idle ≈ free); BYO-account children get read-only console rows (billing posture for hosted children deliberately deferred). Sandboxes: plan 032's lease model realized as auto-stop Machines with staged dists in a volume and pglite in-image for ephemeral state — the machine-provider question plan 032 left open resolves to this substrate.

6. **Data and logs live outside the instance.** Durable Postgres is Neon (per-instance databases; instances are cattle), Redis if ever needed is Upstash, volumes carry only staged dists and scratch. Kubernetes is rejected as a second control plane competing with Alchemy + the reconciler (its PV/operator machinery exists to manage what Neon/Upstash/volumes already own); it is the recorded growth path should fleet scale ever demand scheduling. Coolify is rejected for the same reason (no Alchemy provider — a second control plane) with raw Docker-over-SSH kept as the box-level fallback.

7. **Escape hatches, recorded not built.** Hetzner fleet (consolidation economics at scale) and GCP/Cloud Run (managed-preference shift; private-image contingency via an Artifact Registry remote-repo proxy for external digests — the public GHCR image needs no such proxy today). The adapter seam is what keeps both exits cheap.

**Rejected credentials model:** the platform never holds child-owned infrastructure credentials, and children never hold platform infrastructure credentials. Each side holds only what it owns: children publish (custody publish or their own keys); the platform operates its own substrate.

## Consequences

- The incident class of #526 (publish mutated, repoint failed opaquely) ends structurally: publish + instance convergence become one supervised transaction, and the rollback button turns the recovery from dashboard spelunking into a click.
- The child-side credential surface goes to zero over time — the Railway token is the last per-child infrastructure credential, retired when the reconciler takes over instance convergence.
- The console, reconciler, and rollback unit are developed against the Docker substrate with real containers in CI; production swaps to Railway, then Fly, without touching them.
- We take on uptime ownership only where we choose it (the destination substrate is managed; the escape hatches are not). Patching/uptime of the managed substrate stays with the provider.
- Future seams, recorded not built: per-sandbox billing/quotas (deliberately deferred); multi-region fleet placement beyond the root pair; a substrate-agnostic log query layer if Axiom ever needs swapping.
