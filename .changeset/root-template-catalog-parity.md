---
"everything-dev": patch
---

Root template peer dep normalized to `catalog:` — drift-alarm parity (#545)

The root `package.json` template byte carried `peerDependencies.typescript: "^7.0.2"` (a literal), while the upgrade drift alarm flags any non-`catalog:` ref for an inherited-catalog package — every rc.18+ child's `bos upgrade --check` went red with zero real deltas. The template now uses `catalog:`, and a template↔alarm parity unit test guards the invariant: a dependency field naming a catalog-managed package must use the `catalog:` protocol (or a `workspace:` ref). Children self-heal on their next upgrade when the root migration writes the corrected bytes.
