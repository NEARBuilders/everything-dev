# ADR 0034: The platform release manifest — one pin, everything derived

Date: 2026-10-20
Status: Proposed

Depends on: ADR 0001 (FastKV registry — namespace=signer, action-indexed writes), ADR 0020/0021 (universal runtime image, identity-driven boot), ADR 0031 (package shape), ADR 0032 (framework-owned files inventory), ADR 0033 (database seam).

Implements [docs/plans/054-platform-release-manifest.md](../plans/054-platform-release-manifest.md).

## Context

A child app's sync posture is spread across five surfaces a human must keep in agreement: the pnpm catalog, the shared-dep pins, `ci.image`, the framework-owned file inventory, and the `extends` config. The catalog is already derived (`upgradeTemplate` copies the parent's published catalog through the extends chain), but the rest is hand-correlated: the runtime image is pinned to a sha-tag no tool orders, template sync pulls the parent repo's `main` HEAD rather than any release, nothing verifies the booted host's shared scope against child bundle pins, and a parent's publish gives children no repo-side drift signal. One citynode commit — bump `everything-dev` to `2.0.0-rc.14`, pin the image to `sha-3272362` — is a human correlating two pins no tool checks.

The shape of the fix is a depth move: children currently hold the whole interface (five surfaces); they should hold one string, with a manifest composer holding the implementation.

Considered and rejected: **full runtime shared-scope** (children stop bundling singletons) — maximum decoupling but loses the determinism `syncResolvedSharedDeps` buys and complicates SSR/node remotes; **manifest-in-image-only** — reading it would require a `docker pull` per upgrade check; **npm-as-source** — the npm dist-tag carries no image identity; **embedding the image digest in the manifest** — locally the image builds *after* the FastKV publish, so a digest-bearing manifest cannot ride the atomic config write and the two homes diverge by construction; **caret-tolerant pins and per-dep compat ranges** — indirection nobody needs on day one (recorded as future seams, not built).

## Decision

1. **One manifest per framework release, one composer, two homes.** The deploy train composes a `PlatformReleaseManifest` from release inputs (framework version, release catalog, resolved shared deps, template inventory, compat floor) and publishes it to:
   - **FastKV** — the pointer slot `apps/<root-account>/<root-gateway>/platform.json`, riding the same atomic `__fastdata_kv` write as the config and the per-deploy audit manifest (third `registryEntries` key), carrying the manifest's own SRI. Resolved through the extends chain like the catalog — the root runtime owns it, children read it.
   - **In-image** — generated *inside the docker build* (a `RUN` step after the workspace builds, not a host `COPY`) at the deterministic path `packages/everything-dev/dist/platform-manifest.json`, which the runtime stage copies wholesale. This is a deliberate, tiny exception to ADR 0020/0021's "the image stages no dists": one JSON file, generated in-build so local and CI images are byte-identical by construction. The booted host self-describes (`bos platform manifest`).

   ```jsonc
   {
     "schemaVersion": 1,
     "kind": "everything-dev/platform-manifest",
     "frameworkVersion": "2.0.0-rc.14",      // readFrameworkVersion — the single version source
     "everyPluginVersion": "3.0.0-rc.9",
     "image": { "ref": "ghcr.io/nearbuilders/everything-dev", "tags": ["v2.0.0-rc.14", "sha-32723626"] },
     "catalog": { /* the release catalog — upgrade's existing source, relocated */ },
     "sharedDeps": { /* exact versions + singleton/strictVersion flags — the shared-deps.json shape */ },
     "templateInventory": [ { "path": "…", "sha256": "…" } ],  // ADR 0032's ownership inventory, per-release and hashed
     "compat": { "minChild": "…" }             // global floor, v1
   }
   ```

2. **The digest derives — it is never embedded.** The manifest carries `ref` + tags; deploy preflight resolves `ref@digest` from the registry by the version tag (the image/bundles same-SHA invariant makes this sound, and `computeImageTags` derives the tags from the same git SHA the manifest was composed from). One writer, one write, both homes byte-identical by construction; `ci.image` becomes generated, never hand-pinned.

3. **Children record one exact pin** — `platform: "2.0.0-rc.14"` in `bos.app.ts`. Default (field absent): latest via extends, resolved explicitly inside sync/upgrade (they read the authored config; defu inheritance alone cannot surface it). Offline dev caches the resolved manifest at `.bos/platform-manifest.json` — gitignored local memo; trust lives in the authored pin plus the published manifest. Everything derives from the resolved manifest: catalog entries, `ci.image` → `ref@digest`, and the release-scoped template-sync delta. Invariant, recorded: **the pin is exact in v1 — no ranges; resolution picks one manifest.**

4. **Template sync pulls the release, not `main`.** The manifest names the release; sync threads the release tag through the existing tarball resolver (it already accepts a `ref` and returns the resolved sha), compares local file hashes against `templateInventory`, and touches only changed files. The sync snapshot gains a release-provenance field beside `parentRef`. Child workflow wrappers' reusable-workflow refs (`consumer-deploy.yml@main`) rewrite to `@v<version>` under the same rule. Authority shift, recorded: **at sync time the file-list authority is the release manifest's `templateInventory`; the installed package's inventory remains the fallback when no manifest resolves.** `bos sync` keeps its explicit-drift-pull role, now release-scoped too.

5. **Compatibility is verified, additively.** A new platform check — child slot-pin `requiredVersion` ranges against the manifest's `sharedDeps`, plus the global `compat.minChild` floor, via the existing caret/prerelease-aware range checker — runs at three sites sharing one implementation: `bos platform manifest`, the deploy smoke gate (an in-image read, beside the existing federation exec), and `bos mf check`. The federation check's exact pluginVersion equality is untouched — this check is a sibling, not a relaxation, so previously-green deploys stay green.

6. **Drift alarm and CI wiring.** `bos upgrade --check` diffs the recorded pin against the latest published manifest and exits nonzero on drift (dry-run's existing comparison, mf-check's renderer exit pattern); the child CI workflow template gains a drift job. `config`-only publishes (`bos publish`, no build) skip the manifest leg — it rides the full deploy train only, after the npm-publish preflight gate has confirmed the framework version is actually published.

7. **Additive, not breaking.** Manifest absent → today's behavior (parent-catalog tarball walk against `main` HEAD). Old children upgrade into this world on their next `bos upgrade`; the `platform` field is a new root config key wired through the authored-config schema, serialization order, and sync's managed-key list so it survives personalization.

## Consequences

- The manual `bump + pin image` chore commit dies; dev/prod framework skew becomes mechanically impossible — one field in, catalog, image, sync source, and compat all derived out.
- Sha-tags stop mattering to children; digests derive at deploy time from the manifest's tags.
- Framework releases gain a machine-readable contract; `upgradeTemplate`'s catalog source moves from "walk the parent repo tarball" to one registry read.
- The citynode correlator-commit class of error is caught at deploy time by the platform check instead of at runtime by a federation failure.
- Future seams, recorded not built: caret-tolerant `platform` pins (auto-minor within compat) once range resolution proves out; per-dep compat granularity; a versioned manifest history beside the pointer slot (the registry's history API covers this for now).
