# 0031. Package shape — contract → handlers → services, CLI as presentation

Date: 2026-10-16
Status: Accepted

## Context

`packages/everything-dev` is the one plugin that does not follow the repo's own
plugin convention (`contract` / `handlers` / `services` — see every plugin under
`plugins/`). Its ~45 top-level `src` files mix CLI presentation, handler
orchestration, and domain logic: command handlers are plain `.handler(async)`
bodies with inline `Context.get(context["effect/context"], BosDepsTag)` service
access (the pattern AGENTS.md reserves for streaming handlers), the deploy train
is a god file, and domain modules sit flat beside each other with no layering
rule. The grab-bag `BosDepsTag` (session, db bindings, drizzle kit) is the
de-facto service layer, but services aren't injectable — tests monkeypatch
modules instead of swapping fakes.

## Decision

1. **The package adopts the plugin convention it mandates elsewhere:**

   ```
   src/
   ├── index.ts      # public API barrel ("." export — unchanged)
   ├── sdk.ts        # plugin toolkit re-exports
   ├── plugin.ts     # composition root — initialize → Layer.mergeAll(services),
   │                 #   createRouter(handlers)
   ├── contract.ts   # the command contract; help metadata folds in (ONE flag source)
   ├── handlers/     # thin `.effect(function*)` generators — adapters, no logic
   ├── services/     # all domain logic — Context.Service tags + Layers
   ├── cli/          # presentation only: main + parse/catalog + render/<command>
   └── utils/
   ```

2. **Layering rule:** `cli → contract ← handlers → services`. Services never
   import from `cli/` or `handlers/`; `contract.ts` imports nothing local; the
   plugin definition is the only place layers are wired. Rule of thumb: a
   function needing I/O or state is a service; a pure function is a plain module
   beside its service.

3. **Handlers yield services; `BosDepsTag` dissolves.** New handlers are
   `.effect(function*)` generators resolving services with `yield* Tag` — no
   `Context.get` escape hatch. The `BosDeps` grab-bag is replaced by real
   service tags as domains migrate; `commands/` is deleted when empty
   (the migration is domain-by-domain, behavior-preserving).

4. **Services are the test seam.** Fakes are provided via `Effect.provide` (or
   an injected effect context) instead of module mocking; the real layer lives
   on the service (`static Live`), scoped by the plugin runtime.

## Consequences

- The CLI's implicit architecture (it already boots the plugin runtime and
  calls procedures through the typed client) becomes the file structure.
- Domain migrations (deploy, auth, workspace, registry, resolution, scaffold)
  follow as separate behavior-preserving passes, each updating the exports map
  for moved public entries with breaking changesets (rc pre-mode).
- Per the layered rule, cross-service orchestration (the deploy train's leg
  sequencing) is itself a service, so `bos deploy` and `bos plugin publish`
  share one implementation.

## Exemplar

`bos ps` is the reference conversion: `services/processes.ts` (`ProcessesService`,
fakes via context injection), `handlers/processes.ts` (`.effect` generator),
`cli/render/processes.ts` (presentation). Every later migration copies it.
