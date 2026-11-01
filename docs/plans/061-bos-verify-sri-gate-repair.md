# Plan 061: `bos verify` — one command that proves chain → config → manifest → bytes, and repair the entry-SRI gate that silently never fires

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `docs/plans/README.md` unless the dispatching reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 1e435601..HEAD -- packages/everything-dev/src/services/registry/fastkv.ts packages/everything-dev/src/services/deploy/version-manifest.ts packages/everything-dev/src/services/deploy/integrity.ts packages/everything-dev/src/services/deploy/manifest-verify.ts packages/everything-dev/src/ui/slot.ts packages/everything-dev/src/services/federation/service.ts host/src/services/plugins.ts host/src/program.ts packages/everything-dev/src/cli/commands packages/everything-dev/src/cli.ts`
> On any mismatch, compare the "Current state" excerpts against the live code before proceeding; on a conflict, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (phase B turns on enforcement that was silently absent; CDN propagation windows can now fail loads)
- **Depends on**: none (057's semver module is a nice-to-have for pin reporting but not required)
- **Category**: security / direction (the stated product goal — verifiable execution)
- **Planned at**: commit `1e435601`, 2026-10-28
- **Issue**: https://github.com/NEARBuilders/everything-dev/issues/642

## Why this matters

The product thesis is verifiable execution: the app's full shape is an on-chain artifact (FastKV, ADR 0001) and the runtime provably executes the published bytes (three pin planes, ADR 0036). The pin infrastructure exists — config read-back, version manifests with SRI maps, integrity registries, a well-known fingerprint endpoint — but its verification outputs are internal logs. Two concrete gaps: (1) **the entry-only SRI gate is dead in production** — the registry keys `<base>/remoteEntry.js` while production fetches the *hashed* entry derived from the pin, so `registry.get()` misses and verification silently never happens for pinned slots; (2) **chunk bytes are never verified at load time** — the full per-file SRI map ships inside the verified manifest but nothing consumes it, so a storage-level substitution under a pinned path is undetectable after the entry executes. This plan repairs the dead gate, extends verification to per-file chunks server-side, and assembles the existing verifiers into `bos verify <bos://account/gateway>` — the external "prove it" surface ADR 0036 names as the deliverable.

## Current state

- **The read** — `packages/everything-dev/src/services/registry/fastkv.ts:109-116`, `fetchBosConfigFromFastKv<T>(bosUrl, registry?)` fetches `https://kv.<net>.fastnear.com/v0/latest/<namespace>/<account>/<key>` and `parseFastKvConfigValue` (`:172-184`) trusts `payload?.entries?.find(Boolean)?.value` with no proof check. (Read-side trust is a separate, documented gap — NOT this plan; see Maintenance notes.)
- **Slot resolution** — `packages/everything-dev/src/services/deploy/version-manifest.ts:189-224`, `resolveSlotVersion({base, pin})`: process-lifetime cache keyed `base::pin.manifest::pin.integrity` ("the cache IS the last-known-good"); staged-slot preference first (`readStagedSlotVersion`, `:158-187` — when `BOS_BUNDLE_DIR` is set and the pinned manifest is absent from the staged dir, it takes the NEWEST `versions/*.json` by mtime with **no integrity cross-check**); otherwise `fetchVerifiedManifest` (SRI-verified manifest fetch, `deploy/manifest-verify.ts:31`, never-throws `{ok, manifest|reason}` shape). The derived slot carries the per-file map: `slotVersionFromManifest` (`:123-144`) builds `entryUrl: \`${trimmedBase}/${manifest.entry}\``, and spreads `manifest.files` into `files`.

```ts
// version-manifest.ts:127-143 — the URL-key construction pattern to reuse
const trimmedBase = base.replace(/\/$/, "");
return {
  entryUrl: `${trimmedBase}/${manifest.entry}`,
  entryIntegrity: manifest.entryIntegrity,
  ...(manifest.browserManifest ? { browserManifestUrl: `${trimmedBase}/${manifest.browserManifest.file}` } : {}),
  ...(manifest.ssr ? { ssrEntryUrl: `${trimmedBase}/${manifest.ssr.entry}`, ssrIntegrity: manifest.ssr.integrity } : {}),
  ...(manifest.shared ? { sharedVersions: manifest.shared } : {}),
  ...(manifest.files ? { files: manifest.files } : {}),
  ...
};
```

- **THE DEAD GATE** — `host/src/services/plugins.ts:432-434` registers ONLY the fixed-name entry:

```ts
// host/src/services/plugins.ts:432-434
if (entry.config.integrity) {
  integrityRegistry.registerEntry(entry.config.url, entry.config.integrity);
}
```

  `IntegrityRegistry.registerEntry` (`deploy/integrity.ts:151-153`) keys `resolveEntryUrl(baseUrl)` = `<base>/remoteEntry.js` (`integrity.ts:102-107`). But in production the loader fetches the **hashed** entry: `entryUrls(slot, env)` (`ui/slot.ts:83-101`) returns `slot.entryUrl` when present — which for pinned slots is `<base>/<manifest.entry>` (a hashed filename; ADR 0020 amendment notes the fixed name 404s on the CDN). The fetch hook (`federation/service.ts:51-55`) does `registry.get(url)` with the actual URL and **passes through on miss**. Net: for pinned slots the entry SRI check silently never fires. Verify this claim empirically in Step 1 (it is the plan's central fact).
- **The fetch hook shape** — `packages/everything-dev/src/services/federation/service.ts:44-55`: installs on `(mf as any).loaderHook.lifecycle.fetch.on`; on missing hook surface it logs a warning and skips (fail-open — audit finding, kept out of scope here except that Step 4 must not widen it); chunk URLs during SSR arrive as absolute URLs `<ssrPublicPath><chunkPath>` where `ssrPublicPath` = the manifest URL minus `/mf-manifest.json` (the loader-hook manifest patch at `:19-36`) — i.e. the same base the slot's files are keyed against.
- **Verification primitive** — `verifySriForUrl(url, expectedIntegrity, options)` (`deploy/integrity.ts:121-142`): fetches, hashes, compares; `resolveSriTargetUrl` rewrites non-entry URLs to `remoteEntry.js` UNLESS `options.resolveEntryUrl === false` — verify-callers for hashed files MUST pass `{ resolveEntryUrl: false }` (host callers already do: `snapshot-watch.ts:227-234`, `federation.server.ts:276`).
- **The runtime's self-description** — `host/src/program.ts:154-178`, `GET /.well-known/version`: returns `{ fingerprint, slots: slotPins(pointer), build: {frameworkVersion, everyPluginVersion, gitSha, image}, watch: {lastOutcome} }` with 30 s cache-control.
- **Staged-tier bypass** — `version-manifest.ts:158-187`: the newest-staged-manifest path (above) replaces the chain pin without any SRI check when the pinned manifest is absent from the staged namespace. Deliberate (deploy-lag rationale, comment `:146-157`), but invisible.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0 |
| Framework tests | `pnpm run test:framework` | all pass |
| Host tests | `pnpm --filter host test` | all pass |
| Targeted suites | `pnpm --filter everything-dev test -- integrity version-manifest` | pass |
| Regression (start mode exercises pins end-to-end) | `pnpm run test:db:up && pnpm run test:regression:start:ssr` | green |

## Scope

**In scope** (the only files you should modify):
- `packages/everything-dev/src/cli/commands/verify.ts` (create) + registration in `packages/everything-dev/src/cli.ts` / the command index it uses
- `packages/everything-dev/src/services/deploy/verify.ts` (create — the verification walk, pure + testable)
- `host/src/services/plugins.ts` (Step 3 registration repair + per-file registration)
- `host/src/services/snapshot-watch.ts` / `snapshot-coordinator.ts` (same registration at slot adoption, if that path builds its own registry entries — check first)
- `packages/everything-dev/src/services/deploy/integrity.ts` (add `registerFile` if a per-file registration helper is warranted)
- `host/src/services/federation.server.ts` (the SSR composition path registers per-file entries the same way — follow `ui-compose.ts`'s slot resolution)
- test files for the above

**Out of scope** (do NOT touch):
- FastKV read-side trust (RPC cross-check / signature verification) — separate plan; do not widen this one.
- `readStagedSlotVersion` semantics (the staged bypass stays; Step 5 only adds observability).
- The MF hook fail-open behavior when `loaderHook` is absent (audit finding E9/SECURITY-03) — separate hardening plan; do not couple here.
- `verifySriForUrl`'s rewrite default (changing the default could break existing callers) — new call sites pass the option explicitly.

## Git workflow

- Branch: `feat/bos-verify`
- Commit style: conventional commits, e.g. `feat(cli): bos verify — end-to-end pin verification walk` / `fix(host): register hashed entry + per-file SRI so the integrity gate actually fires`

## Steps

### Step 1: empirically confirm the dead gate (do not skip)

Write a focused unit test against the real `IntegrityRegistry` + the real `resolveEntryUrl`: register an entry with `registerEntry("https://cdn.example.test/slot-a", "sha256-AAA")`, then assert `registry.get("https://cdn.example.test/slot-a/<hashed-entry>.js")` is `undefined` while `registry.get("https://cdn.example.test/slot-a/remoteEntry.js")` is defined. Cross-check against a real build artifact if convenient (`pnpm run build` then inspect a plugin's `plugin.manifest.json`/version manifest for the hashed `entry` filename). This pins the bug the repair fixes.

**Verify**: test red on current code → keep it; it must pass after Step 3.

### Step 2: the verification walk (pure service, `services/deploy/verify.ts`)

Implement `verifyRuntime({ bosUrl, registry?, fetchImpl? })` returning a machine-readable report:

```
{
  ok: boolean,
  config: { ok, source, fingerprint? , error? },
  slots: Array<{ name, ok, pin: {manifest, integrity}, entryUrl?, entryIntegrityOk?,
                filesChecked: number, files: Array<{file, ok}> | "absent" }>,
  runtime?: { url, fingerprintMatch?: boolean | "unreachable" }
}
```

Walk: `fetchBosConfigFromFastKv` → for each slot pin: `resolveSlotVersion` (this already runs `fetchVerifiedManifest` under the hood — surface its `{ok, reason}` rather than swallowing) → `verifySriForUrl(resolved.entryUrl, resolved.entryIntegrity, { resolveEntryUrl: false })` → for each entry of `resolved.files` (when present): `verifySriForUrl(\`${trimBase(base)}/${fileKey}\`, fileSri, { resolveEntryUrl: false })`. File keys are **dist-relative forward-slash object paths** (upload side: `storage.ts:30`) — the `${trimmedBase}/${fileKey}` construction is exactly `slotVersionFromManifest`'s pattern; anything else will never match. Tolerate absent `files` (schema-optional, `every-plugin/src/version-manifest.ts:43`) as `files: "absent"` — report, don't fail. Optional `--runtime <url>` leg: fetch `/.well-known/version` and compare slot pins + fingerprint against the walk. Then a thin `cli/commands/verify.ts` rendering the report (human table + `--json` flag), registered in the CLI index next to the other deploy commands.

**Verify**: `pnpm --filter everything-dev test -- verify` → unit tests of the walk with a stubbed `fetchImpl` pass (happy path; manifest-verify failure → `ok: false` with reason; absent files; SRI mismatch on one chunk → that file false, slot false, walk false). `pnpm run typecheck` → 0.

### Step 3: repair the entry registration (the dead gate)

In `host/src/services/plugins.ts` (and the SSR composition's equivalent registration site — find where `federation.server.ts`/`ui-compose.ts` resolve slots and register entries), replace the fixed-name `registerEntry(...)` with **both**: the hashed entry actually loaded (`slot.entryUrl` → its integrity from the resolved slot) AND the fixed-name fallback (dev slots without pins have no integrity to register — preserve the `if (integrity)` guard). Cleanest shape: extend `IntegrityRegistry` with `registerResolvedSlot(slot: {entryUrl, entryIntegrity, files?, base})` that registers every derivable URL (hashed entry + `<base>/remoteEntry.js` + each `${trimBase(base)}/${fileKey}` → its SRI from `files`). Keep per-file registration FAIL-SILENT-FREE: a missing `files` map registers nothing extra (pass-through behavior preserved).

**Verify**: Step 1's test now passes; `pnpm --filter host test` → green; `pnpm run test:regression:start:ssr` → green (start mode boots from real pins — if the repaired gate now *fires* and any fixture has stale bytes, the suite will say so; that is the gate working — investigate rather than bypass).

### Step 4: failure policy for the fetch hook under per-file verification

Decide and implement the runtime failure path with the reviewer's ratified policy (proposed here): fetch-hook verification failure → (1) if the last-known-good copy of the URL exists in the existing bundle-cache fallback (`federation/service.ts:62-75`), serve it and log a loud `[SRI] chunk verification failed, served last-known-good <url>`; (2) otherwise throw the existing `SriVerificationError` (named, with URL + expected/computed). Mid-SSR hard failure is acceptable for a *never-seen* chunk; the last-known-good path covers propagation windows. Do NOT add a "log and continue" mode for missing per-file keys — absent key = unverified = today's behavior (pass-through), already the documented semantics; flagging absent keys loudly is Step 5's observability, not a failure.

**Verify**: unit test — hook with a registered chunk whose bytes are tampered in a fixture server → last-known-good served (when cached) / `SriVerificationError` (when not); pass-through on unregistered URLs unchanged.

### Step 5: observability for the staged bypass

In `readStagedSlotVersion` (`version-manifest.ts:158-187`), when the bypass path is taken, log one loud line naming the slot and both manifest identities (staged file name + the absent pin manifest), and extend the bypass state into `/.well-known/version`'s payload (a `stagedOverrides: [slotNames]` field) so an auditor can see the runtime is not on the pinned bytes.

**Verify**: `pnpm --filter everything-dev test -- version-manifest` → existing tests pass; add one asserting the log/payload on the bypass path (fake `BOS_BUNDLE_DIR` fixture).

### Step 6: gates

**Verify**: `pnpm run typecheck && pnpm run lint && pnpm run test:framework && pnpm --filter host test && pnpm run test:regression:start:ssr` → all green. Manual smoke against a real publish if the operator provides credentials: `bos verify bos://<account>/<gateway> --runtime <host-url>` → report prints, all slots ok (or names the broken link).

## Test plan

- Unit (`packages/everything-dev`): the Step 1 dead-gate test (red→green); the verify walk with stubbed fetch (happy/degraded/absent-files/mismatch); `registerResolvedSlot` URL derivation table (hashed entry, fixed fallback, file keys with forward slashes, buster-query never present in keys); staged-bypass observability.
- Unit (`host`): fetch-hook policy (tampered chunk → last-known-good / named error; unregistered → pass-through).
- Structural pattern: existing integrity tests (`pnpm --filter everything-dev test -- integrity`) and `remote-entry-readiness.test.ts` for real-runtime fixtures.
- Manual (PR description): end-to-end `bos verify` against the regression start-mode stack.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bos verify --help` exists; `bos verify bos://x/y` runs and emits the per-slot report (against a fixture or the regression stack)
- [ ] The Step 1 dead-gate test passes (hashed entry registered AND verified)
- [ ] Per-file SRI verification active server-side for slots whose manifests carry `files` (unit + regression start:ssr green)
- [ ] Tampered-chunk behavior: last-known-good fallback or named `SriVerificationError` (unit test)
- [ ] Staged bypass logs loudly and appears in `/.well-known/version`
- [ ] All suites green: typecheck, lint, test:framework, host test, test:regression:start:ssr
- [ ] `docs/plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's empirical check shows the hashed entry IS currently registered somewhere else (the gate is alive; the audit premise is wrong) — report where before changing anything.
- The per-file URL keying cannot be derived from `resolved.files` for some slot kind (key shapes that don't match `${base}/${fileKey}`) — report the shape instead of adding a per-kind special case.
- The repaired gate fails `test:regression:start:ssr` on fixtures whose bytes are actually correct (key-derivation bug) vs genuinely stale fixtures — distinguish before touching either side.
- The fetch-hook policy step requires modifying the hook's fail-open skip (`federation/service.ts:44-49`) — that is the separate E9 hardening; report and leave it.
- `bos verify` against a real published runtime shows config-level mismatch (FastKV serving ≠ local) — that is the read-side trust gap; report the evidence for the follow-up plan.

## Maintenance notes

- This command is the assembly point for future verification extensions: FastKV RPC cross-check (read-side trust), image-plane audit (ADR 0036's `platform audit` idea), and tenant-scope verification all bolt onto the same report shape.
- The registry's key contract is now "every URL the runtime can actually fetch" — when a new entry URL form is added (new slot kind, new surface), it must be added to `registerResolvedSlot`, or verification silently doesn't cover it (reviewer checklist item).
- Reviewer scrutiny: (1) no per-file verification regression on dev slots (no integrity → nothing registered → pass-through); (2) the SSR path registers the same set as the plugin path; (3) `resolveEntryUrl: false` on every new `verifySriForUrl` call for non-`remoteEntry` targets.
- Deferred (separate plans): FastKV read-side trust (RPC cross-check at boot/adopt); E9 hook fail-open hardening; browser-side chunk integrity (needs compose-payload design — record the gap in ADR 0036 if not already).
