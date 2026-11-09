---
"everything-dev": minor
---

Per-workspace migration journals (ADR 0045) — the journal's identity follows the workspace's identity, the same rule the data model already follows.

`getMigrationStorage` now resolves `drizzle.__drizzle_migrations_<slug>` by default (the planned phase-2 flag flip). "Every row in my journal is mine" holds by construction, which makes #805's ahead-of-build guard sound again: unknown rows in a workspace's own journal genuinely mean a newer build migrated that database, and boot fails closed with the hashes, timestamps, and remediation (`BOS_ALLOW_SCHEMA_AHEAD=1` allows once). With the shared journal the guard could not work — rows carried no workspace attribution, so every shared-DB workspace saw its siblings' rows and refused boot (the outage the previous patch mitigated by downgrading the guard to advisory).

- **Boot adoption**: on first boot with an empty per-workspace journal, the runner copies this workspace's known hashes out of the legacy shared journal under the workspace's advisory lock — attribution by construction, idempotent, duplicate-DDL tolerant. The legacy table is never modified, so pre-ADR rollbacks keep working (old builds read the legacy journal and apply nothing).
- **Workspace-scoped advisory locks**: the migration runner and the driver's `CREATE SCHEMA` guard serialize on `<journal-schema>.<journal-table>` for the workspace's own journal — cross-workspace boots no longer contend (disjoint schemas; the ADR 0019 catalog race needs same-name objects), same-workspace concurrency still serializes.
- **Zero interface change**: `databaseLayer(tag, url, { pluginId, schema, migrations, namespace })` is untouched; drizzle-kit configs, Studio, and CLI bindings already routed through the journal resolver and follow automatically. `{ isolated: false }` remains an explicit override to the legacy shared coords.
- Journal `created_at` is coerced at the read seam (node-postgres delivers bigint as a string; `new Date("1730…").toISOString()` was the `RangeError` that turned the guard's clean failure into `unknown failure`).
