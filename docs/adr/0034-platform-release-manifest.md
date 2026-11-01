# ADR 0034: The platform release manifest — one pin, everything derived

Date: 2026-10-20
Status: Accepted (amended 2026-10-23, #546)

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

2. **The digest derives — it is never embedded.** The manifest carries `ref` + tags; deploy preflight resolves `ref@digest` from the registry by the version tag (the image/bundles same-SHA invariant makes this sound, and the tags derive from the version alone — no git fact an image build cannot see). One writer, one write; `ci.image` is removed entirely (amended 2026-10-21, #493 — a deploy fails fast when an authored config sets it). The one publisher-side divergence between the homes is the compat floor: the FastKV copy's floor is the previous release (a fetch *failure* skips the manifest for that deploy rather than publishing a silently wrong window), while the in-image copy — which cannot read the registry inside the build — stamps its own version, a floor that only ever fails closed.

3. **Children record one exact pin** — `platform: "2.0.0-rc.14"` in `bos.app.ts`. Default (field absent): latest via extends, resolved explicitly inside sync/upgrade (they read the authored config; defu inheritance alone cannot surface it). Offline dev caches the resolved manifest at `.bos/platform-manifest.json` — gitignored local memo; trust lives in the authored pin plus the published manifest. Everything derives from the resolved manifest: catalog entries, the deploy-time image ref `ref@v<version>` + registry digest (the `ci.image` slot is gone — amended 2026-10-21, #493), and the release-scoped template-sync delta. Invariant, recorded: **the pin is exact in v1 — no ranges; resolution picks one manifest.**

4. **Template sync pulls the release, not `main`.** The manifest names the release; sync threads the release tag through the existing tarball resolver (it already accepts a `ref` and returns the resolved sha), compares local file hashes against `templateInventory`, and touches only changed files. The sync snapshot gains a release-provenance field beside `parentRef`. Child workflow wrappers' reusable-workflow refs (`consumer-deploy.yml@main`) rewrite to `@v<version>` under the same rule. Authority shift, recorded: **at sync time the file-list authority is the release manifest's `templateInventory`; the installed package's inventory remains the fallback when no manifest resolves.** `bos sync` keeps its explicit-drift-pull role, now release-scoped too.

5. **Compatibility is verified, additively.** A new platform check — child slot-pin `requiredVersion` ranges against the manifest's `sharedDeps`, plus the global `compat.minChild` floor, via the existing caret/prerelease-aware range checker — runs at three sites sharing one implementation: `bos platform manifest`, the deploy smoke gate (an in-image read, beside the existing federation exec), and `bos mf check`. The federation check's exact pluginVersion equality is untouched — this check is a sibling, not a relaxation, so previously-green deploys stay green.

6. **Drift alarm and CI wiring.** `bos upgrade --check` diffs the recorded pin against the latest published manifest and exits nonzero on drift (dry-run's existing comparison, mf-check's renderer exit pattern); the child CI workflow template gains a drift job. `config`-only publishes (`bos publish`, no build) skip the manifest leg — it rides the full deploy train only, after the npm-publish preflight gate has confirmed the framework version is actually published.

7. **Additive, not breaking.** Manifest absent → today's behavior (parent-catalog tarball walk against `main` HEAD). Old children upgrade into this world on their next `bos upgrade`; the `platform` field is a new root config key wired through the authored-config schema, serialization order, and sync's managed-key list so it survives personalization.

## Amendment (2026-10-23, #546 — shared-singleton truth gates)

The first pin cycle exposed the failure class the manifest was designed to
prevent — it just surfaced at the *composition* end, not the publish end. A
root republished with a drifted `react` while a pinned child stayed on the
old install; the child's bundles still claimed to satisfy the parent config,
and the composition died with the federation runtime's negotiation error
(`__webpack_modules__[e].call`). Five lessons, now shipped as gates:

1. **Bundles declare what they embed.** Every uploaded workspace's build
   report records the shared-singleton versions its build actually installed
   (`sharedVersionRecord` in `every-plugin`'s build plugins); the version
   manifests carry them, and UI slots stamp `sharedVersions` beside the pin.
   A pin now names bytes, not a wish.
2. **The publish train verifies the declaration.** The truth gate
   (`platformTruthViolations`) cross-checks every workspace's embedded
   versions against the release manifest's `sharedDeps` and fails the publish
   (`PublishTrainError` kind `platform-truth`) on disagreement — a stale
   install can no longer publish a manifest that lies about the uploaded
   bytes.
3. **The booted host fails loud.** The boot guard in `ui-compose` raises
   `SharedSingletonSkewError` when the core-UI provider and consumer slots
   disagree on strict singletons — the named error replacing the cryptic
   negotiation crash.
4. **Pre-flight mirrors exist before the crash.** `bos mf check` gained the
   UI composition gate (`checkUiCompositionCompat` — the boot guard's mirror,
   naming slot=version pairs), and `bos platform manifest --check` reports
   pin drift ("parent platform is X (published), you pinned Y") instead of
   surfacing the pin-not-found error raw.
5. **Bundles are traceable to the release that built them.** The build train
   stamps `MF_BUILD_VERSION` from the installed framework version, so a
   bundle's provenance is a fact, not a guess.

**Stale-pin semantics, decided empirically:** a root republish overwrites the
`platform.json` pointer slot; a child pinning a version the chain no longer
serves resolves only while the fresh `.bos/platform-manifest.json` cache (24h
TTL) still stands in — past that, resolution fails loud with
`platform pin <version> not found in the extends chain`. This is accepted
as-is (the upgrade is the pathway that clears it); the versioned manifest
history that would make old pins resolvable indefinitely stays a recorded
future seam below.

The pin lifecycle is exercised end-to-end by
`packages/everything-dev/tests/integration/platform-upgrade-e2e.test.ts`
(publish → pin → deploy derivation → stale fail-loud → re-pin → skew replay).

## Amendment (2026-10-28 — release-scoped extends inheritance)

The skew-loud boot (item 3 above) exposed a residual structural gap, observed
often in the wild: a child pinned to rc.N — its lockfile, and therefore its own
`ui`/plugin builds, at rc.N — inherits the `app.auth` slot (children never
author it; `bos init` deletes the whole `app` slot) from the parent's **live
config pointer**, whose auth bundle moved to rc.N+1 the moment the root
published. The next child deploy/restart composed auth@rc.N+1 with ui@rc.N and
degraded health. The platform pin governed image, sync, and compat *reporting*
— but nothing mapped it onto inherited slot pins: extends inheritance was
pointer-live, not release-scoped.

Two changes, shipped together, make a pinned child's runtime a deterministic
function of (child code, pinned release):

1. **The release manifest records its own slot-pin map** (the `slots` field —
   additive, optional; old readers strip it). The release leg composes it from
   the release's publish payload: every pinned slot, keyed by dotted config
   path (`app.auth`, `app.auth.ui`, `plugins.votes.ui`, …), each carrying the
   slot's production base and its immutable version-manifest pin. Old releases
   carry no `slots`; old pins stay resolvable forever, so the slots the map
   does record survive every later root publish.
2. **The deploy train stamps inherited slots from that map.** Before the
   boot-check walk, every remote slot the leaf does *not* author (present in
   the release's `slots` map, not authored by the leaf) is re-pointed at
   the release's recorded production URL + pin — child-wins over the parent's
   live pointer at every consumer boot. A slot is authored only when its entry
   names a code source (`production`, `development`, `pin`, `extends`, `proxy`,
   a bare plugin ref, or `ui: false`); an entry carrying only configuration
   (`variables`, `secrets`, …) is still stamped, its configuration kept
   (amended 2026-11-01, #679). Slots the child authors stay untouched;
   a no-`slots` manifest stamps nothing; rollback payloads are canonical and
   skip stamping.

Finally, the deploy train gained the **composition gate** (`PublishTrainError`
kind `composition`, Layer 1 of the fix): before publish, the extends-merged
shape is cross-compared on embedded shared singletons — the same check the
booted host performs, moved to preflight — and a pinned child additionally runs
`checkPlatformCompat` against **its own** resolved release (never the parent's
latest). A skewed composition now dies as a red CI run with the `bos upgrade`
remediation named, instead of as a degraded production boot.

Relaxing the `everything-dev/ui/auth` strict singleton to sonner-style
tolerance was explicitly rejected: the singleton exists because two divergent
session-read copies disagreed into redirect loops (d57b8f4); tolerance
reintroduces that bug class. Children pinned to pre-`slots` releases are
protected by the composition gate until their next `bos upgrade` + deploy makes
release-scoping effective.

## Consequences

- The manual `bump + pin image` chore commit dies; dev/prod framework skew becomes mechanically impossible — one field in, catalog, image, sync source, and compat all derived out.
- Sha-tags stop mattering to children; digests derive at deploy time from the manifest's tags.
- Framework releases gain a machine-readable contract; `upgradeTemplate`'s catalog source moves from "walk the parent repo tarball" to one registry read.
- The citynode correlator-commit class of error is caught at deploy time by the platform check instead of at runtime by a federation failure.
- With release-scoped extends inheritance, a root publish can no longer skew or break an un-upgraded platform-pinned child's runtime; child deploys stay green between `bos upgrade`s.
- Future seams, recorded not built: caret-tolerant `platform` pins (auto-minor within compat) once range resolution proves out; per-dep compat granularity; a versioned manifest history beside the pointer slot (the registry's history API covers this for now — and per the #546 amendment, it is also the fix for stale pins outliving a republish); boot-time release scoping for children pinned to pre-`slots` releases that cannot redeploy.
