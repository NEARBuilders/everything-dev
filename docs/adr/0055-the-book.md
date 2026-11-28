# 0055 — The book: a narrative manual layered over the decision ledger

Date: 2026-11-28
Status: accepted
Builds on: 0053 (docs content sources), 0054 (content collections), PR #450

## Context

The repository records its architecture in 53 ADRs — context, decision,
consequences, one file per decision, amended in place by dated sections. They are an
excellent ledger and a poor manual. They are organized by time, written for the
people who were present, and dense with incident references a newcomer does not
have. `AGENTS.md` is the operating guide agents need, the skills are task-shaped, and
[how-it-fits.md](../agents/how-it-fits.md) tours the runtime — but no document
teaches the framework as a whole. An app author had to reconstruct the model from
fifty decision records.

The docs plugin (ADR 0053, 0054) turned the repository's markdown into a published
surface, which made the gap visible on the website: `/docs` served every file flat,
and `llms.txt` and `skill.md` had nothing deep to point an agent at.

Two temptations were rejected up front. **Rewriting the ADRs into readable prose**
destroys exactly what makes them valuable — the dated decision, the status, the
amendment trail — and still produces fifty disconnected memos. **A separate docs
site** creates a second source that drifts from the first.

## Decision

**1. Three layers, distinct jobs, one source.**

| Layer | Where | Job | Shape |
|---|---|---|---|
| The book | `docs/book/` | Teach the platform as it is | Chapters by concept, in reading order |
| The ledger | `docs/adr/` | Record how it came to be | One immutable record per decision |
| Operations | `docs/agents/`, `AGENTS.md`, `packages/*/skills/` | Rules and task walkthroughs | Imperative, task-shaped |

[docs/README.md](../README.md) is the **documentation map** — the entry point that
says what the repository is, what each tree is for, and where new writing goes. All
of it is compiled by the docs plugin from the same git tree, so the website cannot
drift from the repository. The reader renders the map at `/docs` when the corpus has
one; a corpus without it gets the plain index.

**2. The book synthesizes and cites; the ledger is never rewritten.** A chapter gives
the big ideas and the concepts a builder needs, names the commands that check its
claims, and ends with the decision records and skills it rests on. Depth stays in the
primary source.

**3. Drift is governed by four rules.**

- An ADR wins. When a chapter and a decision record disagree, the chapter has a bug.
- An ADR change obligates a chapter check. A new or amended record must be searched
  for in `docs/book/` before the change lands.
- The book is in the link checker's scope — `pnpm run docs:check` resolves every
  path it names.
- Status is stated. A chapter that describes a direction records whether it is
  accepted, proposed, or deferred; it never presents a proposal as fact.

**4. Every link is a repository path.** Documents link to each other, to skills, and
  to source the way GitHub resolves them — relative, real paths — which is what the
  link checker can verify. The reader resolves them at render time:

| The link names | It opens |
|---|---|
| A document in the compiled corpus | `/docs/<slug>` |
| A package skill (`packages/<pkg>/skills/…`) | `/skills/<pkg>/…` |
| A public asset (`ui/public/<file>`) | `/<file>` |
| The root `README.md` | `/about` |
| Anything else in the repository | The repository, at the path — on its default branch |

Repository links derive from the runtime config's `repository` field, so a runtime
that composes the docs plugin sends source links to its own repository. The
default branch is addressed as `HEAD`; no branch name is guessed.

A link resolves against the document's own repository file — every record carries
`file`, and a corpus compiled before the field existed derives it from the slug.
The repository-only forms are matched first: the root `README.md` would otherwise
collide with a page whose slug is also `README`. A link into the corpus navigates
in the reader without a document reload; a link that leaves the app opens in a new
tab. Until the navigation tree has loaded the corpus is unknown, and a document
link is assumed compiled.

**5. Documents are published; repository examples are not.** Plans, audits, and
design maps are documents and join the corpus. Runnable prototype trees under
`docs/plans/prototypes/` are code with a README — they stay in git and are excluded
from the compiled set.

**6. The entry points point.** `llms.txt` and `skill.md` link the map and the book at
stable URLs — `/docs`, `/docs/book`, `/docs/adr` — rather than enumerating pages, so
they do not change when a chapter does.

**7. The read API is on every API surface.** The docs routes join the base API
router, so they are reachable over RPC, REST, OpenAPI, and MCP like every other
route — an agent fetches a page with a plain `GET /api/docs/{slug}` and reads raw
markdown. The per-plugin RPC mount alone leaves an API RPC-only. Slugs are
path-shaped, so the REST parameter uses the reserved expansion (`{+slug}`); query
strings arrive as strings, so query parameters coerce.

**8. The reader's stylesheet stands on its own.** A plugin's utilities must sort
after the host's, or its responsive variants lose to the host's base classes. A
nested `utilities.*` layer sorts *before* its parent's own rules, so the docs UI
emits its utilities into a top-level layer it declares last — which also holds for
a runtime that composes the docs UI remotely and cannot re-source its classes.

## Consequences

- An app author can learn the platform in one sitting and descend into the ledger
  at the exact record behind any statement.
- The manual is the first thing a reader sees in the sidebar, and the ledger is one
  click away.
- The book is one more surface an ADR change must touch. The cost is bounded — a
  search for the record's number — and it is the price of having a manual that is
  true.
- The sidebar opens the first top-level section — the one frontmatter `order` puts
  first — and keeps every other directory closed until it holds the current page.
- Link resolution resolves against the compiled corpus, so a document that links a
  markdown file the corpus does not include lands in the repository instead of a
  404.
- Repository links assume a GitHub-shaped `repository` URL. On another host the
  reader leaves the path as written — the pre-existing behavior.
- Two ADRs share the number 0046 (the verification spine; manifest attribution).
  Both predate this record; the index now lists both, and this book cites each by
  filename. The numbers are not reassigned.

## Alternatives considered

- **Rewrite the ADRs in place.** Loses the decision history the ledger exists to
  keep, and yields prose still organized by decision rather than by concept.
- **Generate the book from the ADRs.** Structure would follow decisions, not
  understanding; the editorial act — what to leave out — is the value.
- **A longer book.** Verbose chapters restate their sources and drift twice as
  fast. The length budget is a maintenance property.
- **Absolute site URLs in documents.** Unverifiable in the repository and broken on
  GitHub; the repo-relative form is checkable before publish and resolved after.
