---
"everything-dev": patch
"ui": minor
"api": minor
---

Fix the tenant publish plane: the apps plugin no longer overrides the registry namespace, so tenant config publishes (including DAO-owned tenants via the Trezu flow) now target the global `dev.everything.near` registry that `bos://` resolution and the host's tenant loader actually read. Previously the wizard wrote configs into a project-local FastKV trie that the host could never resolve.

Tenant discovery moves to the project database: a new public `GET /tenants/apps` route lists active tenants with their primary hostname and attached geographic node, and the landing-page directory is now powered by it (rows link via their stored binding hostname instead of deriving `slug.gateway`). The wizard's publish re-check reuses the shared `buildRegistryConfigUrl` helper, and a pinned test guards the publish contract against future namespace drift.
