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

- [ ] T1 — `services/platform/manifest.ts` (new): `PlatformReleaseManifest` Zod schema +
        composer from release inputs — `readFrameworkVersion` (`deploy/image.ts`), release catalog
        (pnpm-workspace.yaml), sharedDeps (the `.bos/generated/shared-deps.json` shape /
        `shared-deps-spec` lists + flags), image ref + tags from `computeImageTags` (no digest),
        compat floor
- [ ] T2 — publish legs, one producer two homes: third `registryEntries` key in
        `deploy/train.ts` (rides the atomic write + read-back); Dockerfile `RUN` generation step
        after the workspace builds (mirror the existing build-time `RUN` precedent) emitting
        `packages/everything-dev/dist/platform-manifest.json`; manifest SRI computed like bundle SRI
- [ ] T3 — `services/scaffold/ownership.ts` inventory gains per-file sha256 (builds on ADR 0032);
        composer consumes it for `templateInventory`; both a local-inventory and a
        manifest-supplied adapter satisfy one read interface

## Child-side win checklist (T4–T5)

- [ ] T4 — *(tracer bullet)* `upgradeTemplate` consumes the manifest
        (`services/scaffold/upgrade.ts`, `services/resolution/init-source.ts`): catalog source
        switch; `ci.image` → `ref@digest` derivation at deploy preflight (`handlers/deploy.ts`
        error messages updated); `platform` pin record/read — `BosConfigInputSchema` +
        `BosConfigSchema` + `BOS_CONFIG_ORDER` + `managedRootKeys` (or `personalizeConfig` strips
        it); `.bos/platform-manifest.json` cache; manifest-absent fallback to today's tarball walk;
        idempotent across the upgrade re-exec
- [ ] T5 — release-scoped, delta-driven `syncTemplate` (`services/scaffold/sync.ts`): thread the
        release tag through `downloadTarball` (already accepts `ref`) at every call site
        (`resolveSourceDir`, extends-chain walk); compare against `templateInventory` hashes;
        sync-snapshot gains release provenance beside `parentRef`; `.github/templates/workflows/*.yml`
        `@main` refs → `@v<version>`

## Verification checklist (T6–T7)

- [ ] T6 — boot verification: `bos platform manifest` (in-image read; CLI catalog + contract route +
        renderer); the platform compat check as one implementation with three call sites — command,
        smoke gate (new `docker exec` step beside the `mf check` poll, `deploy/smoke.ts`),
        `mf check` (`services/federation/service.ts` reuses its range checker) — fails the deploy on
        violation
- [ ] T7 — `bos upgrade --check` (dry-run comparison + nonzero exit on drift, mf-check renderer
        pattern) + child CI drift job in `.github/templates/workflows/ci.yml`

## Docs checklist (T8)

- [ ] ADR 0034 + `docs/adr/README.md` index row
- [ ] `docs/plans/README.md` queue row
- [ ] GLOSSARY.md: Platform release manifest, Derived pin (with `_Avoid_:` lines)
- [ ] `init-upgrade` + `everything-dev-app` skills: the pin field, `--check`, release-scoped sync
- [ ] Guardrail tests extending `sync.structure.test.ts`: marker ↔ inventory ↔ manifest
        `templateInventory` agreement
- [ ] Changesets per implementation PR (`"everything-dev": minor`, ADR 0034 cited; docs PRs carry none)

## Verification gates

Per PR: `pnpm run typecheck` + `pnpm run lint`; `pnpm --filter everything-dev test` for
T3–T7 units; one deploy-train integration test asserting the manifest rides the atomic write and
the read-back confirms it (T2); a fallback test asserting manifest-absent behavior is byte-identical
to today's flow (T4/T5); smoke-gate test with a deliberately skewed slot pin (T6).
