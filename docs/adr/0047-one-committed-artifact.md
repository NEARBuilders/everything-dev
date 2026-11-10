# 0047 — One committed artifact (the lock absorbs the sync baseline)

Date: 2026-11-10

## Context

Child repos committed four runtime-state artifacts: `bos.lock.json`, `.bos/sync-snapshot.json`, `.bos/infra-state.json`, and (historically, force-added) `.bos/generated/auth/auth-export.d.ts`. The snapshot predated the lockfile and overlapped it — a second, parallel "what state am I pinned to" file with different semantics. Its costs were concrete: every `bos upgrade` rewrote ~70 hash lines of pure churn (NEARBuilders/nearbuilders.org#403), it conflicted across long-lived branches, and the template's `.gitignore` needed negations (`!.bos/sync-snapshot.json`, `!.bos/infra-state.json`) to keep the files committed at all. Worse, a missing snapshot degraded silently: sync's three-way comparison classified an unbaselined-but-locally-modified file as `updated` and let the template win, with nothing but a backup to notice. (#844; the consolidation constraint is ADR 0042's: don't add a lockfile as one more authority — consolidate.)

## Decision

**One committed artifact: `bos.lock.json`.** The sync baseline moves into it as the optional `template.sync` section (`{ syncedAt, files }` — per-file template content hashes). The lockfile already froze the composition (release pin, remote digests, SRI integrity); it now also records the template baseline the sync conflict-detection compares against. Everything under `.bos/` becomes local-only runtime state; the template `.gitignore` ignores `.bos/` wholesale (new scaffolds already did — the negations lived only in the parent repo's own `.gitignore`, now removed, and `.gitignore` is framework-owned sync inventory, so children reconcile on their next upgrade).

Design rules that keep the lock honest:

- **The baseline is an annotation, not composition.** `template.sync` is never produced by `lockfileOf`, never enters `pointerDigest` or `digestOfLockfile` — the lockfile digest answers "what exact composition was live", and a baseline splice is not a composition change. Writers (`writeLockfile`, `writeLockfileSync` — `bos lock`, the deploy train's persist leg) carry the annotation forward from the existing file, so a producer rewrite never silently drops the baseline, and `lock --check`'s byte comparison stays stable across syncs.
- **One drift mechanism, three consumers.** `lock --check` (composition vs committed lock — the CI drift gate), `bos verify` (served bytes + attribution vs pins, ADR 0046), and sync's conflict detection (local edits vs template via the baseline) all read the same file.
- **No baseline ⇒ conflict, never a silent win.** A file that differs from the template with no recorded baseline classifies `conflicted` — the run aborts without `--force`, and the error names the remedies: record a baseline (`bos lock` + commit) or take the template once (`--force`, backed up). Fresh clones stay safe — init writes the baseline, and a committed lock carries it.
- **Lock-less repos keep working.** `writeSnapshot` prefers the lock when one exists (splice-only — a sync never recomputes remotes) and falls back to the legacy `.bos/sync-snapshot.json` file when it doesn't. The legacy file is the absorb source, not a second authority.

**Migration.** `bos upgrade`'s migration phase absorbs a legacy `.bos/sync-snapshot.json` into the lock's `template.sync` and deletes the file wherever a lock exists (reported as `bos.lock.json` under migrated files); an already-absorbed lock treats the file as a stale duplicate and removes it; without a lock the file stays, now local-only. Untracking a still-tracked copy is the plain deletion the user commits — the reconciled `.gitignore` prevents re-tracking. Dev ports (`infra-state.json`) stay machine-local untracked prefs — ports are machine prefs, not pinned truth; nothing in the lockfile.

## Consequences

- The churn problem dies at the root: baseline updates splice one key inside a file that changes on template moves anyway, and `.bos/` regains a single rule — local-only.
- The fresh-clone hazard inverts: the old fallback overwrote unknown local edits silently; the new one refuses loudly with two named remedies. The cost is a one-time `--force` (or `bos lock` + commit) on repos carrying real local edits and no baseline.
- A transitional window exists: a lock carrying `template.sync` fails strict parse on a pre-0047 CLI — `readLockfileIfExists` returns null and boot degrades to the unfrozen composition with a warning. The window closes on `bos upgrade`; the fail-soft path is the lockfile's designed degradation, not a new one.
- The child-side CI gate becomes real: children commit their lock, wire `bos lock --check` into their CI (release-pinned compositions resolve immutably, so the gate is quiet until the child changes something — exactly when it should speak), and treat drift as the upgrade prompt it is.
