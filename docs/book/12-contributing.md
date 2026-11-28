---
title: "12 · Contributing"
description: How work lands here — where a change belongs, the contribution flow, the standards code is held to, when to write a test and when to write a decision, and where new writing goes.
order: 120
tags:
  - book
---

# 12 · Contributing

This repository is the framework's home. A change here reaches every app built on the
platform, through a package version or a template sync — so the first question about
any change is not *how* but *where*.

## Where a change belongs

| The need | Belongs in |
|---|---|
| Only this app needs it | The app's own code — routes, components, a local plugin |
| A second app would need it | The framework — this repository, shipped in a package version |
| A child app hit a bug | The framework, if it reproduces against the pinned release; the child, if not |

The test is cheap: run with the piece in question loaded remotely (`bos dev --ui
remote`) and see whether the bug survives. Searching the framework's issues comes
before building; an existing issue gets a repro, not a duplicate.

**Framework-owned files are a contribution channel, not a fence.** Editing one locally
is legitimate — keep the repo green, then file the issue that makes the change
permanent upstream. A local edit with no upstream counterpart dies at the next
`bos upgrade`. ([ADR 0032](../adr/0032-framework-owned-files.md))

## The flow

1. One branch per ticket, off `main`. Stack a branch only when it builds on unmerged
   work, and branch from the named base — never from whatever the working tree
   happens to hold.
2. Keep the verification green: `pnpm run typecheck`, `pnpm run lint`, the suites
   your change touches, and `pnpm run docs:check` for any documentation.
3. Add a **changeset** for a user-facing change to a publishable package — anything
   under `packages/`. Documentation-only, internal, and test-only changes need none.
4. Open the PR. CI runs lint, typecheck, and the unit suites a change touches; the
   slow full-stack suites run at the publish gate and nightly, where a decision is
   made.

## Standards

The rules are short because each one closes a class of drift:

- **Write code once.** Two copies of one behavior will disagree.
- **Types are the drift killer.** Never cast away an error to silence it; generated
  types are never hand-maintained.
- **No comments in implementation.** A `KEEP` comment earns its place; a `TODO` names
  a ticket.
- **Semantic Tailwind, kebab-case files, neighboring patterns.** `bg-background`,
  not a literal color.
- **Effect, idiomatically.** Services are `Context.Service` tags with `Live` layers,
  scoped resources are released by finalizers, and a definitive failure inside a
  generator is `return yield* new SomeError(...)`. Effect lint rules that are errors
  are fixed in code, not suppressed.

The vendored Effect source under `repos/effect` is the source of truth for Effect
idioms — read it, never import from it.

## When to write a test

| The behavior is… | Assert it in |
|---|---|
| Observable by a user | A browser regression spec |
| Unreachable from the browser — crypto, protocol verification, pure state machines, fault injection, migrations, CLI contracts | A unit test |
| What a mock was configured to return | Nothing. That is not a test |

Prefer the layers a renderer swap cannot delete — Node tests of extracted logic and
behavioral browser specs. The testing doctrine names each tier and says when it runs.

## When to write a decision

Record an **ADR** for a decision that is hard to reverse. The format is fixed —
context, decision, consequences — and the ledger has three rules: take the next free
number and never reuse one; amend by appending a dated section; leave superseded
records in place, linking their replacement. An ADR is a dated claim about the past,
which is why it is never rewritten.

## Where new writing goes

| You are writing | It goes in |
|---|---|
| An explanation of a concept | A chapter of this book |
| A decision | `docs/adr/` |
| An operating rule for agents | `docs/agents/` |
| A task walkthrough | A skill |
| A plan, audit, or prototype | `docs/plans/` |
| A term | `GLOSSARY.md` |

A new or amended ADR obligates a check of the chapters that cite it — search this
book for its number. [The documentation map](../README.md) is the full version.

## Check it

- `pnpm run typecheck` · `pnpm run lint` · `pnpm run test` — the three gates.
- `pnpm run docs:check` — every link and path the documentation names still exists.

## Further reading

- [Change placement](../agents/change-placement.md) — the full decision procedure, including stacking and cleanup at source.
- [Coding standards](../agents/coding-standards.md), [testing doctrine](../agents/testing.md), [Effect patterns](../agents/effect-patterns.md).
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md) — setup, branch naming, semantic commits, the PR process.
- The [`everything-dev#code-style`](../../packages/everything-dev/skills/code-style/SKILL.md) skill, and [`everything-dev#add-a-route`](../../packages/everything-dev/skills/add-a-route/SKILL.md) for a complete change end to end.
- ADRs [0032](../adr/0032-framework-owned-files.md) (ownership and the upstream protocol) and [0055](../adr/0055-the-book.md) (how the documentation is layered).
- Next: [13 · Reference](13-reference.md).
