---
"everything-dev": minor
---

Generated infra now includes isolated test databases alongside dev databases. `docker-compose.yml` gains `postgres-api-test` (port 5434, `api_test_db`) and `postgres-auth-test` (port 5435, `auth_test_db`) services, and a committed `.env.test` maps every `*_DATABASE_URL` secret and `BETTER_AUTH_SECRET` to the test databases. Test suites load `.env.test` instead of `.env`, so regression runs (which drop and reseed plugin schemas) can never touch dev data. The infra planner also skips persisting port state when `NODE_ENV=test` or `BOS_TEST=1`, in addition to the existing `BOS_NO_PERSIST_PORTS=1`, preventing test runs from repinning dev ports.
