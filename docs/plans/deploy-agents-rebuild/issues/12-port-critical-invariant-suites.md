# 12: Port the critical invariant test suites

**What to build:** Port the invariant-bearing integration suites from the upstream repo
— intent invariants, operation admission, policy finalization, spend-budget races, and
maintenance races — to the plugin test setup, running against the test database (pglite
for unit-adjacent coverage, the test Postgres for the race suites). Preserve their
scenario coverage; these suites are the real value of the upstream test estate. The
mainnet e2e suites stay upstream.

**Blocked by:** 09 (owner intent flow).

**Status:** ready-for-agent

- [ ] Intent-invariants suite ported and passing
- [ ] Operation-admission suite ported and passing
- [ ] Policy-finalization suite ported and passing
- [ ] Spend-budget race and maintenance race suites ported against the test Postgres
- [ ] Suites run via the repo's standard test commands in CI
