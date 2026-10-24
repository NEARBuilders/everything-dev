# 054. Platform release manifest — one pin, everything derived

Ticket tracker: `.scratch/platform-release-manifest/`
Branches: `feat/platform-manifest` (this doc + ADR), implementation tickets stacked below, on
`feat/database-seam` (ADRs 0032/0033).
ADR: `docs/adr/0034-platform-release-manifest.md`.

## Design (locked)

- **One manifest, one composer, two homes.** `PlatformReleaseManifest` composed once by the
  deploy train; published to the FastKV pointer slot `apps/<root-account>/<root-gateway>/platform.json`
  (third `registryEntries` key in the atomic config write, own SRI) and generated in-image at
  `packages/everything-dev/dist/platform-manifest.json` inside the docker build (recorded exception
  to the no-dists rule, ADR 0020/0021).
- **The digest derives, never embeds.** Manifest carries `ref` + tags; deploy preflight resolves
  `ref@digest` from the registry by the version tag. This is what makes both homes byte-identical
  and keeps the publish a single atomic write (locally the image builds after publish — an embedded
  digest would force a second write path).
- **One exact pin.** `platform: "2.0.0-rc.14"` in `bos.app.ts`; absent = latest via extends,
  resolved explicitly in sync/upgrade (they read the authored config). Cache: gitignored
  `.bos/platform-manifest.json`. No ranges in v1.
- **Sync pulls the release.** Release tag threaded through the tarball resolver; delta against
  `templateInventory` hashes; snapshot gains release provenance; `@main` reusable-workflow refs
  rewrite to `@v<version>`. Authority at sync time: the manifest's inventory (installed package's
  inventory stays as fallback).
- **Compat verified additively.** New platform check (slot-pin `requiredVersion` ranges +
  global `compat.minChild` via the existing range checker) shared by `bos platform manifest`,
  the smoke gate, and `bos mf check`. The federation check's exact pluginVersion equality is
  untouched.
- **Flat by construction.** One composer module, one FastKV key, one authored field, one check
  implementation, one exit-code convention. No versioned slots, no caret ranges, no per-dep compat,
  no sprint folder — the tickets are the table below.

## Foundation checklist (T1–T3)

- [x] T1 — `services/platform/manifest.ts` (new): `PlatformReleaseManifest` Zod schema +
        composer from release inputs — framework version (`deploy/image.ts` `readFrameworkVersion`),
        release catalog (pnpm-workspace.yaml), sharedDeps (the shared-deps-spec lists +
        `shareConfigFor`), image ref + *derivable* tags only (sha-tags are git facts an image
        build cannot see — the manifest carries `v<version>` alone)
- [x] T2 — publish legs, one producer two homes: third `registryEntries` key in
        `deploy/train.ts` (rides the atomic write + read-back; the per-deploy audit manifest
        gains `platformManifest: { file, integrity }`); Dockerfile `RUN` generation step
        (`scripts/generate-platform-manifest.ts`) emitting
        `packages/everything-dev/dist/platform-manifest.json` in the builder stage; SRI over the
        serialized bytes (`deploy/platform-manifest.ts`)
- [x] T3 — `computeTemplateInventory(sourceDir)` in the platform module: ownership inventory +
        agent globs + `plugins/_template` scaffolding, full sha256 per file, sorted; the composer
        consumes it; the guardrail test pins marker ↔ inventory ↔ manifest agreement

## Child-side win checklist (T4–T5)

- [x] T4 — *(tracer bullet)* `platform` pin end-to-end: `BosConfigInputSchema` +
        `BosConfigSchema` + `BOS_CONFIG_ORDER` + `managedRootKeys` (survives `personalizeConfig`);
        `resolvePlatformManifest` (nearest-chain-wins without a pin, exact-match-or-loud with one,
        `.bos/platform-manifest.json` cache, all I/O injectable); `upgradeTemplate` switches the
        catalog source to `manifest.catalog` when a manifest resolves, surfaces
        `platform` + `updatesAvailable` on the result
- [x] T4 (closed as a recorded decision) — `ci.image` derivation: the seam is landed and tested
        (`deriveImageRefFromPlatformManifest` → `ref@v<version>`); wiring it into deploy preflight
        has **no real caller today** — the child tier skips the image leg by design (ADR 0021) and
        root/pre-pushed deploys pin via `BOS_IMAGE_DIGEST` — so the consumer lands with the
        self-deploy flow that actually hand-pins an image (plan 042-adjacent). One adapter means a
        hypothetical seam; the seam ships when the second adapter arrives.
- [x] T4 (consumer landed, 2026-10-21) — the second adapter arrived: #493. `ci.image` is removed
        entirely (deploy fails fast on it via the session's `unknownAuthoredKeys`); the child pin
        resolves manifest → `ref@v<version>` → registry digest, the Railway leg repoints the
        service source (`service source connect --image <ref:tag>`) before `redeploy
        --from-source`, and `--smoke` boots the pinned digest. ADR 0021 amendment (2026-10-21).
- [x] T5 — release-scoped, delta-driven `syncTemplate`: release tag threaded through
        `resolveSourceDir` → `downloadTarball` (already accepted `ref`); `applyReleaseRefs`
        rewrites the framework's own reusable-workflow `@main` refs → `@v<version>` at
        content-build time (hash-compare and written bytes stay consistent; third-party
        `@main` actions are never repointed); sync snapshot gains `release` provenance;
        manifest-absent → today's flow (existing sync tests pass unchanged)
- [ ] T5 (open seam, #589) — consume `templateInventory` hashes at sync time to skip the tarball
        download when nothing changed (today the release tarball is downloaded and the existing
        three-way hash compare does the touching-only-changed work — same outcome, one download).
        The cheap correct delta test is snapshot provenance: `snapshot.release ===
        manifest.frameworkVersion` → nothing to pull; wiring it means restructuring syncTemplate's
        single download-and-compare block — schedule with the next sync-touching change.

## Verification checklist (T6–T7)

- [x] T6 — `bos platform manifest` (contract route `/platform/manifest` + handler + renderer,
        mf-check pattern): in-image read first, registry resolution otherwise, `--check` runs the
        compat gate and exits 1 on violations; the smoke gate reads + parses the in-image manifest
        and fails the boot gate when the release contract is missing (summary reports `platform:`)
- [ ] T6 (follow-up, #590) — run the full `checkPlatformCompat` at the smoke gate (the in-image step
        today verifies presence + shape; the compat data isn't in the container's workspace), and
        wire the additive `platform` section into `mf check`'s report (`MfCheckResultSchema` +
        handler). The one implementation is already shared; both are call-site wiring.
- [x] T7 — `bos upgrade --check` (dry-run semantics + `process.exit(1)` when
        `updatesAvailable`; schema flag + renderer) + `.github/templates/workflows/ci.yml`
        platform-drift job (`pnpm exec bos upgrade --check`)

## Docs checklist (T8)

- [x] ADR 0034 + `docs/adr/README.md` index row
- [x] `docs/plans/README.md` queue row
- [x] GLOSSARY.md: Platform release manifest, Derived pin (with `_Avoid_:` lines)
- [x] `init-upgrade` + `everything-dev-app` skills: the pin field, `--check`, release-scoped sync — plus the follow-on docs pass: AGENTS.md (sync/publish quick reference + release flow), `cli-reference` (`bos platform manifest` section, `upgrade --check`), `publish-sync` (manifest leg, release-scoped sync, `--check`), `registry` (`platform.json` + audit manifest key layout), `extends-config` (`platform` pin section, full `BOS_CONFIG_ORDER`), `docs/self-deploy.md` (child-tier Railway redeploy semantics, platform pin)
- [x] Guardrail tests extending `sync.structure.test.ts`: marker ↔ inventory ↔ manifest
        `templateInventory` agreement
- [x] Changesets per implementation PR (`"everything-dev": minor`, ADR 0034 cited; docs PRs carry none)

## Verification gates

Per PR: `pnpm run typecheck` + `pnpm run lint`; `pnpm --filter everything-dev test` for
T3–T7 units; one deploy-train integration test asserting the manifest rides the atomic write and
the read-back confirms it (T2); a fallback test asserting manifest-absent behavior is byte-identical
to today's flow (T4/T5); smoke-gate test with a deliberately skewed slot pin (T6).
