---
"everything-dev": minor
---

Registry wire cutover (ticket 10): `manifest.json` thin tag + `versions/<v>.json` records, strict no-alias resolution

The registry wire cuts over atomically with this release. **Old CLIs fail loud until `bos upgrade`** — a child below the cutover floor resolves nothing and is told to upgrade.

**New keys** (the old `platform.json`, `platform-versions/`, and `manifests/` keys are abandoned in place — FastKV is immutable, never written again):

- `apps/<account>/<gateway>/manifest.json` — the thin tag: `{ schemaVersion, version, digest }`; the digest pins the record's exact bytes
- `apps/<account>/<gateway>/versions/<v>.json` — the full manifest, immutable
- `apps/<account>/<gateway>/deploys/<ts>.json` — the per-deploy audit record

**Strict no-alias cutover**: resolution speaks only the new format. An extends target still publishing the pre-cutover composition is rejected loud: "the runtime you extend publishes a pre-cutover composition — it must redeploy on ≥ 2.0.0-rc.37". No dual-read, no legacy parser in the core. The resolution machine verifies the thin tag's digest against the fetched record's bytes — a mismatch is an `integrityFailure`, never a silent pass.

**Manifest + config wire**: the manifest's `slots:`/`pin:` maps are now `remotes:`/`digest:`; stamped config entries carry `digest:` (republishes scrub legacy `pin:` stamps). The compat floor never sits below the cutover release — pre-cutover children cannot parse the wire.

**Operator notes**:

- Run `bos upgrade` on any child before (or immediately after) the parent's first post-cutover deploy; until then the child fails loud with exactly that instruction.
- The release train writes the version record + flips the thin tag in one atomic FastKV write; publish confirmation now verifies both legs byte-equal before the publish counts.
- `bos manifest` (`--check`) replaces the retired `bos platform manifest` surface.
- The compat window's non-release freshness gate now compares against the published version record the tag names (the full manifest no longer rides the pointer).
