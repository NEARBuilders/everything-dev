---
title: The everything.dev book
description: The manual — the model, how a runtime is put together, and how to author, run, publish, and trust one. Thirteen short chapters, each citing the decisions behind it.
order: 1
tags:
  - book
---

# The everything.dev book

The book is the platform's manual. It explains the framework as it is today — the
ideas, the parts, and how they fit — in reading order. It is written for three kinds
of builder: the **app author** composing a runtime, the **plugin author** extending
one, and the **platform contributor** changing this repository.

It is deliberately short. Each chapter gives the big ideas and the concepts you need,
names the commands that let you check every claim, and points at the primary sources
— Architecture Decision Records, skills, and operating docs — for depth. The ADRs are
the decision ledger; this book summarizes them and never replaces them.

## Contents

**The model**

1. [The model](01-the-model.md) — one authored file, composed at runtime, verified end to end
2. [Anatomy of a runtime](02-anatomy.md) — the parts, and who owns what

**Authoring**

3. [Configuration](03-configuration.md) — `bos.app.ts`, `extends`, the lockfile, file ownership
4. [Composition](04-composition.md) — remotes, mounts, precedence, shared singletons, content
5. [Plugins](05-plugins.md) — contract, handlers, services, build, publish

**Running**

6. [The development loop](06-development-loop.md) — `bos dev`, ports, logs, hot reload
7. [Data](07-data.md) — the database seam, PGlite, migrations
8. [Identity](08-identity.md) — sign-in, organizations, gasless writes, agent access

**Shipping and trusting**

9. [Publishing](09-publishing.md) — the registry, the deploy train, releases
10. [Verification](10-verification.md) — the spine, the pin planes, boot, supply chain
11. [Tenancy and direction](11-tenancy-and-direction.md) — tenants, hosting, where the platform is going

**Working here**

12. [Contributing](12-contributing.md) — change placement, standards, testing, decisions
13. [Reference](13-reference.md) — commands, agent entry points, where to look

## How to read it

| You are… | Read |
|---|---|
| New to the platform | 01 and 02, then follow your task |
| Building an app | 01–04, then 06, 08, and 09 |
| Building a plugin | 02, 04, 05, then 06 and 07 |
| Changing the platform | All of it, starting with 12 |

## Conventions

- **Vocabulary** follows [the glossary](../../GLOSSARY.md). Where a chapter uses a
  defined term, the glossary's meaning is the one intended.
- **Check it** names the commands that prove the chapter's claims. The repo's posture
  is checked, not trusted: when a document and the runtime's own state disagree,
  believe the state and fix the document.
- **Further reading** lists the decision records and skills a chapter rests on, in
  the order worth reading them.
- **Status** is stated. Most of the platform is accepted and shipped; a few
  directions are recorded but not built, and the chapters say so.
