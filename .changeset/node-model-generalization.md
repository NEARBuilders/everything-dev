---
"ui": minor
"api": minor
---

Generalize the node model beyond geography. The `nodes.kind` column and its `country`/`state`/`city` enum are gone — the kind label now lives in `nodes.metadata.kind` (geo specifics become plain metadata), `parentId` is the only hierarchy axis, and `nodes.tenantId` is nullable so standalone org/user/zone-root nodes can exist without a tenant. New org-scoped `spawnNode` route (`POST /nodes/spawn`) creates nodes of any kind under any parent with no kind-validated parentage or depth limit; `applyNodeProposal` keeps the strict geo ladder as the DAO provisioning path; the validator staking walk and `listTenantApps` are unchanged (already `parent_id`-driven) and now carry nullable, open-ended kind labels. UI kind displays fall back to a generic "Community" label for non-geo kinds, and standalone nodes can only be mutated by platform admins.
