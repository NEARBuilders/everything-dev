---
"everything-dev": patch
---

Template/upgrade script hygiene (#799, #802): the child root `test` script's
plugins loop is guarded with `[ -d plugins ]` (matching the typecheck script),
so plugin-less children no longer exit 1 with all suites green; and `bos
upgrade` retires the dead `dev:postgres` / `dev:postgres:down` /
`dev:postgres:reset` scripts left in children scaffolded before ADR 0038
retired docker-compose.
