---
name: everything-dev-app
description: Orient in an everything.dev app repo created via `bos init` and run the ordered development workflow end to end. Use when starting work in a scaffolded child repo, deciding which workflow skill to use next, planning a feature, fixing a bug, or publishing changes to your runtime.
---

# Everything.dev App Workflow

You are in an everything.dev app: a child repo scaffolded by `bos init` that **extends** a parent runtime on-chain. Your overrides (typically `ui/`, maybe `api/`, `plugins/`) are local; everything else resolves from the parent at runtime via `bos.config.json` (`extends` chain, FastKV-published).

Read `AGENTS.md` first — it has the run, deploy, and architecture guidance for this specific repo.

## The ordered flow

Work in this order. Each step names the skill that owns it. `/ask-matt` is the router if you are unsure where you are.

1. **Sharpen the idea** — `/grill-with-docs` interviews until the design is sound, leaving a paper trail in `CONTEXT.md` and `docs/adr/`. For pure decisions without docs, `/grilling`. For handing a plan to a future session, `/to-spec`.
2. **Chart the work** — `/to-tickets` breaks the spec into tracer-bullet tickets (vertical slices, each demoable, each declaring blocking edges) under `.scratch/<feature>/issues/`. For huge, foggy efforts, `/wayfinder` instead.
3. **Work the frontier** — pick any ticket whose blockers are done. `/implement` builds it, driving `/tdd` at pre-agreed seams. `/diagnosing-bugs` is the loop for hard bugs and performance regressions.
4. **Review** — `/code-review` audits the diff since a fixed point on two axes: Standards (this repo's documented conventions) and Spec (what the ticket asked for).
5. **Ship** — `bos publish --deploy` publishes your config and bundles to FastKV under your account; the Railway instance picks it up in minutes. Deploy surface details live in `AGENTS.md`.

## Where things live

- `docs/agents/issue-tracker.md` — tracker conventions (local `.scratch/<feature>/issues/` + GitHub when published)
- `docs/agents/triage-labels.md` — the five canonical triage roles
- `docs/agents/domain.md` — domain doc layout (CONTEXT.md / ADRs)
- `AGENTS.md` — run, deploy, architecture, and style rules for this repo

## Investigate narrowly

Do not excavate framework internals. Rules of thumb:

- **Generated files are never hand-edited** — anything `*.gen.ts` (API/auth types) regenerates from `bos.config.json` via `bos types gen`. Change the config, not the artifact.
- **Framework code resolves from npm**, not from your repo — host, auth, and plugin runtime behavior is inherited from the parent via `extends`. To understand or change it, load the matching TanStack Intent skill (`bunx @tanstack/intent@latest load everything-dev#...`, `every-plugin#...`, `better-near-auth#...`) instead of hunting source.
- **Your repo owns the overrides only** — UI routes you add under `ui/src/routes/`, API routes in `api/src/contract.ts` + `api/src/index.ts`, your plugins under `plugins/`. Start searches there.
- **Run `/setup-matt-pocock-skills` once** before using the tracker/triage skills; it configures the issue tracker, triage vocabulary, and domain doc layout for this repo.
