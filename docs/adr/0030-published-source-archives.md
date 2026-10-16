# ADR 0030: Published source archives — bos:// byte-sourcing for `bos import`

Date: 2026-10-15
Status: Accepted
Amends: [ADR 0020](0020-child-bundle-storage-r2.md) (the storage plane now carries a second artifact class: source, beside dists)
Companion: `bos import` chain resolution (issues #405/#406, `every-plugin/version-manifest` contract)

## Context

`bos import` dereferences a `bos://` ref through the extends chain to a
GitHub repository and pin (`repository` + version-manifest `gitSha`). That
keeps the storage plane dist-only, but the bytes still come from GitHub:
the source of truth for an import is a *different* system than the source
of truth for the deployed runtime. Three failure modes follow:

1. **Drift** — the parent's repo HEAD or the pinned ref moves; the imported
   bytes are no longer what the deployed dist was built from.
2. **Availability** — the import breaks when the parent's `repository` is
   absent or private, even though the parent's *published* runtime fully
   describes the workspace the child is deriving from.
3. **Fidelity ceiling** — version manifests pin dist bytes by SRI, but the
   corresponding *source* bytes were never pinned anywhere, so "import
   exactly what the parent deployed" was unimplementable.

## Decision

**Source becomes a published artifact class beside dists, opt-in per
runtime, recorded in the same version manifest, and preferred by `bos
import` over GitHub.**

1. **Publish side.** When the authored config opts in via
   `publish.sourcePublish: true`, the deploy train builds a per-workspace
   source tar.gz — same ignore set `bos import` classifies under (the
   shared `WORKSPACE_SUBTREE_IGNORE`; one source of truth both sides), paths
   repo-root-relative so the extracted root is a drop-in for the GitHub
   tarball root — and uploads it content-addressed to
   `source/source.<sha>.tar.gz` beside the dists. The **server-computed**
   SRI (MAP decision 6) lands in the workspace version manifest's optional
   `source: { file, integrity }` field. Deploys stamp the manifest's
   `gitSha` (`git rev-parse HEAD`, best-effort), making the chain pin's
   exact-commit promise live. Both fields participate in the version hash;
   enabling source publishing therefore changes the workspace's version id
   on the next deploy. The legacy changesets-tag mapping sketched in issue
   #406 is superseded: the manifest's own `gitSha` is strictly more precise.

2. **Governance.** One global flag on the `publish` block, inherited
   child-wins through extends — a tenant extending a private base does not
   leak its source by default. The source archive contains the workspace
   subtree only (no `.bos`, no `.env`, no VCS state); secrets never ride it.

3. **Import side.** `bos import` prefers the archive: the ancestor's pinned
   version manifest — itself now **SRI-verified** against the config slot
   pin's integrity, closing the unverified-fetch gap the first chain-
   resolution cut shipped with — names the archive; the bytes are fetched,
   SRI-verified, and extracted repo-root-relative, and everything
   downstream (classification, migration reconciliation, route deltas) sees
   a shape identical to the GitHub tarball root. `repository` becomes
   optional when an archive exists: byte-sourcing works when the parent's
   repo is absent or private. On archive fetch failure or SRI mismatch the
   import falls back to the chain-resolved GitHub coordinate with a warning
   — except manifest tampering, which hard-errors rather than silently
   downgrading the source of truth.

4. **Dev equivalence.** The payoff is a child that can run a *local* plugin
   that is byte-identical to the parent's deployed one: import the workspace
   from the chain (exact published source, no GitHub dependency), declare it
   `local:` in the child's authored config, and dev/build treat it like any
   local workspace. Re-imports classify against the snapshot — divergence
   from the parent's deployed source is always explicit.

## Consequences

- **Storage weight** grows by roughly the workspace's source size per
  opt-in runtime (typically lighter than dist + sourcemaps); the
  content-addressed key makes both the client-side diff (previous pin's
  `source.integrity`) and the server-side stat no-op dedupe a no-change
  redeploy into zero archive bytes moved, and hashed names get immutable
  CDN caching for free.
- **Cross-package contract**: the `source` field is additive in
  `every-plugin` (readers predating it strip unknown keys); the coordinated
  release ships every-plugin before everything-dev.
- **Not byte-sourcing at runtime** — this pins *import* inputs. The host
  still boots dists; a future issue may archive source archives into the
  boot path, but this ADR deliberately keeps the boot surface untouched.
- **Smoke, rollback, fingerprints** are pin-level or boot-surface checks
  and are unaffected; the archive leg skips memory backends like the pin
  leg does.
