---
name: delete-comment
description: Audit a code surface's comments, classify each as tautology, excuse, stale, or decision record, delete the first three, move decisions into ADRs, file issues for the hacks they were hiding, then ratchet the comment budget down. Use when asked to remove comments, clean up a file's commentary, enforce the no-comments standard, or repeat a comment audit on another part of the codebase.
---

# Delete comments

This repo's standard is **no prose comments in implementation**. Reasoning lives
in ADRs, contracts describe API shape, and names carry intent. This skill runs
that standard over a chosen surface without breaking behavior, and leaves the
budget lower than it found it.

The budget is real: `pnpm run lint:comments` fails when any file exceeds its
entry in `scripts/comment-budget.baseline.json`, and new files start at zero.
Everything below exists to lower that file honestly.

## 1. Scope

Take the surface the user named. If they said "this PR", use:

```bash
git diff --name-only "$(git merge-base origin/main HEAD)" HEAD
```

If they said "this file" or "this directory", use that. Never widen silently —
a repo-wide pass is 600+ files and belongs in its own PR.

Then list every comment in scope with line numbers:

```bash
node scripts/comment-budget.mjs --list <files...>
```

## 2. Classify each comment

Read the code around it first. A comment that looks like a tautology can be the
only record of a decision.

| Class | Test | Action |
|---|---|---|
| **Tautology** | Restates what the code already says (`/** The slug. */` above `slug: string`) | Delete |
| **Stale** | Names a file, ADR number, function, or behavior that no longer exists | Delete |
| **Excuse** | Justifies a shortcut the code should not take — empty `catch`, swallowed error, magic sentinel, duplicated logic, `as any` | Delete, then fix the code or file an issue |
| **Decision record** | Explains a non-obvious choice a future reader would otherwise undo, especially one paid for by an incident | Move to an ADR, then delete |

Signals of a decision record: it cites an ADR, an issue, a date, or a failure
mode (`__webpack_modules__[r] is not a function`, "EMFILE", "404s mid-rebuild"),
or it explains why an unusual setting exists.

Signals of an excuse: the comment is the only thing making the code acceptable
(`/* not up yet */` in an empty catch, "best-effort" over a swallowed error).

**Directives are never comments.** `// biome-ignore`, `// oxlint-disable`,
`// @ts-expect-error`, `/// <reference`, `// @vitest-environment`,
`//#region`, shebangs, and `// @generated` are instructions to tools. The budget
script already excludes them; leave them alone.

## 3. Act

**Delete** tautologies and stale comments outright.

**For excuses**, prefer a code fix that removes the need for the comment:

- empty catch → `await x().catch(() => null)` then test the result
- optional preload → `queryClient.prefetchQuery(...)` (never rejects) instead of
  `ensureQueryData` in a try/catch
- magic string → a named constant
- swallowed failure → return the error to a caller that can show it

When the fix is larger than the audit, delete the comment and file an issue
under `.scratch/<feature>/` (see `docs/agents/issue-tracker.md`), naming the
file and the hack. An undocumented hack that survives is a bug in the audit.

**For decision records**, put the decision in the ADR that owns the area — do
not create one ADR per comment. Check for an existing home first (`docs/adr/`);
extend it with a short section. Cite the failure the decision prevents, not the
implementation that happens to satisfy it today.

**Never move reasoning into `GLOSSARY.md`.** The glossary is domain vocabulary
only — terms, their meaning, and the distinctions between them. Rationale,
incident history, and implementation detail belong in ADRs; a glossary entry
that explains *why* something works the way it does is a misplaced ADR.

## 4. Ratchet

After deleting, regenerate the baseline and verify:

```bash
node scripts/comment-budget.mjs --update   # rewrite from the working tree
node scripts/comment-budget.mjs --check    # must pass
node scripts/comment-budget.mjs --estimate # totals + hot spots
```

`--update` is the only way to move the baseline, and it must only ever go down
for files you touched. If it goes up, you added a comment — put the content in
an ADR instead.

Report the shed: lines before, lines after, and what remains in scope.

## 5. Verify

Deleting comments must not change behavior:

```bash
pnpm run typecheck
pnpm run lint
pnpm test        # or the workspace's own suite for the touched packages
```

If an ADR gained a section, check its links resolve (`pnpm run docs:check`) and
that any ADR numbers it cites still match (`docs/adr/README.md`).

## 6. Finish

- The diff contains only deletions, the ADR prose that replaced them, and any
  excuse-fix the audit justified.
- `scripts/comment-budget.baseline.json` is smaller for every file touched.
- Issues exist for every excuse left unfixed.
- Nothing moved into `GLOSSARY.md` except genuine vocabulary.
