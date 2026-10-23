---
"everything-dev": major
---

Release-scoped child lifecycle (ADR 0034): children become pinned snapshots that move only through `bos upgrade`.

**Removed**
- `bos sync` is gone. The template-sync engine (`syncTemplate`) is now reachable only through `bos upgrade`, which gates it on the platform release manifest and the framework version delta. `bos sync` invocations in scripts/agents must be replaced with `bos upgrade`.

**Changed**
- `bos init` / `bos upgrade` stamp a `platform` pin (the framework release version) into the authored config; everyday resolution (sync, runtime boot) freezes to it, and the upgrade pathway is what moves it.
- Template sync is release-scoped: it resolves the platform release manifest (failing loud when none publishes) and pulls the release tag, not `main` HEAD. Workflow reusable-action pins are rewritten to `@v<version>`.
- The legacy `bos.config.json` scaffold path is retired from the template surface: `syncTemplate` reconciles TS-form children only (`bos.app.ts`).children scaffolded as JSON configs upgrade to the authored descriptor form.
- Upgrade preflight refuses to apply new framework packages while framework-owned files conflict with the upstream release; `--force` bypasses and backs up conflicting copies under `.bos/sync-backup/`.
- Init snapshots record the delivered (personalized) bytes of framework-owned files, so upgrade hand-edit detection compares against what the scaffold actually wrote.
- TS-form children now get their personalized workspace manifest and catalog in `personalizeConfig` (previously skipped by the JSON-config branch), so `catalog:` refs normalize on sync.
- The child-owned block protocol (`// child-owned-start|end` markers) lets hand-authored spans inside framework-owned files (e.g. `api/plugin.dev.ts` `variables`) survive reconciles without conflict.

**Fixed**
- TS-form children keep their authored identity fields (account/domain) across template sync instead of drifting back to the extends-derived defaults.
