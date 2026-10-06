# ADR 0027: Every app is a node

Date: 2026-10-06
Status: Accepted

Apps already extend each other (`bos://<account>/<gateway>` → `extends`), but plugins have no identity of their own: `bos plugin publish` rewrites the host app's whole config, and the only way to point at a plugin is a fragment into someone else's config (`bos://acct/gw#plugins.registry`). Most plugins are apps — an API and a UI exposed for composition — so we treat every app as a **node** in one graph, and give plugins a real address nested under the node that publishes them: `bos://<account>/<gateway>/plugins/<id>`, stored at `apps/<account>/<gateway>/plugins/<id>/bos.config.json`. The authoring surface does not change: a node is still `App(...)`, `gateway` keeps its name, and `RuntimeConfig` stays in code as a historical name; "Runtime" now means the `everything-dev` package and host that run nodes.

## Decisions

1. **Address.** A node is `bos://<account>/<gateway>[/plugins/<id>]…`; the path nests, so a child node can compose its own children. `parseBosUrl` and `getRegistryConfigKey` (`packages/everything-dev/src/fastkv.ts`) already accept the trailing segments. Nested addresses mirror the bundle layout (`bundles/<account>/<gateway>/<workspace>/…`, ADR 0015/0020), avoid global plugin names, and let one prefix scan of `apps/<account>/<gateway>/` return a node and everything under it.
2. **Ownership is on-chain.** The signing account owns the node (ADR 0001, unchanged) — a single-key account or a multisig; Sputnik DAOs are multisigs and publish through a proposal whose `FunctionCall` executes as the DAO. An organization never owns a node: it **links** to owners through a verified `linkAccount { accountId, kind: "account" | "multisig" }` (the member's signed-in NEAR account, or on-chain membership of the multisig), replacing the unverified `linkDao`. An account links to at most one organization.
3. **Follow by default.** A composed or extended reference follows the target's latest publish — instant updates are the point. `@<version>` pins to the content-addressed version manifest that already exists (`every-plugin/src/version-manifest.ts`). Contract checks gate a follow before the new version is adopted.
4. **Contracts make swaps checkable.** A node declares the contracts it provides (its published contract types, by sha256 and semver) and requires. A UI node requiring `auth@^1` runs over any node providing it — "swap the UI, keep the functionality" becomes a check, not a hope.
5. **Node card.** Each published config carries a node card — title, extends, surfaces, provides/requires, skill URL, MCP endpoint, source (repository, git sha) — also served at `/.well-known/bos.json`, so agents and the registry discover nodes the same way (aligned with NEP-330 source metadata, agent skills, and `.well-known/mcp.json`).
6. **Graduation.** A child node that moves to its own domain publishes at the new top-level address, and its old nested address `extends` the new one, so existing composers keep following.

## Considered options

- **Flat `bos://<account>/<name>` for plugins** — host-independent identity, but needs globally unique names per account and redefines `gateway` as a generic name. Rejected; graduation (6) covers the independence case.
- **`modules/{ns}/{name}` + ModuleRecord** (beta-v2 map decision #3) — a second key space and record type beside app configs. Rejected in favour of one config shape at every level of the tree; the record's useful fields land in the node card.
- **Organization-owned nodes** — would make an off-chain auth record the authority over an on-chain write. Rejected; ownership follows the signer.

## Consequences

- The registry indexes nested configs and shows "used by" for every node; a plugin that has not published under its own nested address is shown as embedded until it does.
- `bos plugin publish <id>` must write `apps/<account>/<gateway>/plugins/<id>/bos.config.json` and the parent references it with `Plugin(id).extends("bos://…/plugins/<id>")`; the CLI and publish track is shared with the citynode "Everything is a node" wayfinder (citynode.app#233–#252).
- Each plugin directory moves from `plugin.dev.ts` to the `bos.app.ts` + `bos.dev.ts` pair, so any node can boot standalone on the universal image (ADR 0021).
- The dev panel can only write a node when the connected wallet is its owner; multisig owners get a proposal flow later.
