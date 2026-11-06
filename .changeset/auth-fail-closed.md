---
"everything-dev": patch
---

Auth production-safety family (#803/#804/#805):

- **Fail closed in production when `AUTH_DATABASE_URL` is unset.** The auth
  plugin's secrets schema no longer silently defaults a deployed host to a
  fresh, empty PGlite data dir — production boots without the URL now refuse
  with an error naming the variable and the fix. The zero-config default
  stays for local dev; `AUTH_ALLOW_PGLITE_DEFAULT=1` accepts it deliberately.
- **Fail closed when the shared auth DB's migration journal is ahead of the
  plugin's known set.** `runMigrations` compares the journal against the
  build's known hashes before migrating: unknown rows (a newer plugin build
  migrated this DB) fail the boot with the unknown hashes, timestamps, and
  remediation instead of silently writing on top of an unseen schema.
  `BOS_ALLOW_SCHEMA_AHEAD=1` permits a deliberate rollout.
- Preflight no longer recommends clearing `AUTH_DATABASE_URL` without a
  production caveat.
