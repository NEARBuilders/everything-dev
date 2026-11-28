---
title: Documentation map
description: What this repository is, where every document lives, and how to read it — the entry point for people and agents.
order: 0
tags:
  - book
---

# Documentation map

This repository is **everything.dev** — the open runtime for apps on NEAR, and the
home of the framework that runs it. It holds three published packages
(`everything-dev`, `every-plugin`, `better-near-auth`), the universal runtime image,
and the platform's own app. It is the **parent** of every app built on the platform,
not a generated child project.

Everything written about it lives in this repository and is published by the docs
plugin: the markdown under `docs/` is compiled when the plugin builds and served
read-only at `/docs`. There is no second copy to keep in sync — edit the file, merge,
and the site follows.

## The repository

| Path | What lives there |
|---|---|
| `bos.app.ts`, `bos.dev.ts` | The authored runtime config, and its dev-only overlay |
| `host/` | The gateway: Hono server, oRPC mounting, the Module Federation host, SSR, tenant resolution, the agent surfaces |
| `ui/` | The core UI: React 19, TanStack Router and Query, the design system |
| `api/` | The slim API shell: app-level routes and the database layer |
| `plugins/` | Auth, registry, proposals, votes, ai, docs, agent-connect — and the `_template` scaffold |
| `packages/everything-dev` | The `bos` CLI and framework: dev session, build and deploy train, resolution, scaffold, database and UI runtimes |
| `packages/every-plugin` | The module seam: `createPlugin`, the build composition, the plugin runtime |
| `packages/better-near-auth` | Sign in with NEAR for Better Auth |
| `apps/` | The destination shape — verifiable apps and a runtime composer |
| `infra/` | Infrastructure as Effects |
| `tests/regression` | The full-stack regression suites |
| `AGENTS.md` | Operating guide for agents, and the deepest technical document in the repo |
| `GLOSSARY.md` | The vocabulary — every term with the synonyms to avoid |

## The documentation

| Document | What it is | Read it when |
|---|---|---|
| [The book](book/) | The manual — the model, authoring, running, publishing, and trusting a runtime, in reading order | You want to understand the platform |
| [The ADR ledger](adr/) | Architecture Decision Records — context, decision, consequences; one record per decision | You want to know *why* it is like this |
| [Agent docs](agents/) | Operating rules: testing, coding standards, Effect patterns, the deploy flow, the runtime map | You are changing the platform |
| [Plans](plans/) | Implementation plans, audits, prototypes, and decision maps — in flight and done | You are executing or archaeologizing work |
| [Plugin docs](plugins/) | An overview of each plugin that ships one | You are using or extending a plugin |
| [Self-deploy](self-deploy.md), [seed phase](seed-phase.md) | Task-shaped guides | You are shipping an app or seeding data |
| [Glossary](../GLOSSARY.md) | The vocabulary | A term is unfamiliar |
| [Contributing](../CONTRIBUTING.md), [security](../SECURITY.md) | The contribution flow and the security policy | You are opening a PR or reporting a problem |

The book explains the platform **as it is**; the ledger records **how it came to be**.
A chapter summarizes many decisions and links them; a decision record is never
rewritten into prose. When the two disagree, the ADR wins and the chapter has a bug.

## Where to start

| You are… | Start |
|---|---|
| Learning the platform | [The book](book/), front to back — it is short |
| Building an app | [The model](book/01-the-model.md), then [Configuration](book/03-configuration.md) and [Publishing](book/09-publishing.md) |
| Building a plugin | [Plugins](book/05-plugins.md), then the `everything-dev#plugin-development` skill |
| Changing the platform | [Contributing](book/12-contributing.md), then `AGENTS.md` |
| An agent with a task | `/skill.md` picks the one skill for the task; the book is the background it assumes |

## Where new writing goes

| You are writing… | It belongs in |
|---|---|
| An explanation of a concept | A book chapter — keep it short and cite the decisions |
| A decision that is hard to reverse | An ADR — take the next free number |
| A rule for how agents work | `docs/agents/` |
| A task walkthrough | A skill, under `packages/*/skills/` |
| A plan, audit, or prototype | `docs/plans/` |
| A term the project relies on | `GLOSSARY.md` |

## Writing rules

- **Link by repository path.** A relative link to a real file works on GitHub and
  resolves on the site: documents open in the reader, skills open under `/skills`,
  and anything else opens in the repository. `pnpm run docs:check` verifies them.
- **Use the glossary's vocabulary.** Every entry lists the synonyms to avoid.
- **Depth stays in the primary source.** A chapter gives the idea and points at the
  ADR; it does not restate it.
- **Check every claim.** Prefer naming the command that proves a statement.
- **A new or amended ADR obligates a chapter check** — search the book for its number.
