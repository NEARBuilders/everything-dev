---
"everything-dev": patch
---

Migration drift detector tracks table lifecycle (#312): `extractExpectedTables` now removes tables on `DROP TABLE` and re-keys on `ALTER TABLE ... RENAME TO` (schema-qualified or bare, `IF [NOT] EXISTS` forms included) — dropping or renaming a table in a migration no longer puts every subsequent boot into unfixable `drift-manual`. Also: `bos key generate` defaults to **keeping** existing publish keys — removal requires an explicit prompt answer or `--remove-old-keys` (#247).
