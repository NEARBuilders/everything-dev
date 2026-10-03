---
"everything-dev": minor
---

`bos init` delivers a child-sized docker-compose (api + api-test Postgres,
no auth databases — auth is inherited via extends) and only when the api or
host workspace is overridden locally.
