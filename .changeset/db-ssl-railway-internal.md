---
"everything-dev": patch
---

fix(db): treat `*.railway.internal` database hosts as local (no TLS verification)

`resolvePoolSsl` verified certificates for any bare non-local URL, but Railway
private-network Postgres (`auth-db.railway.internal`, `api-db.railway.internal`, …)
presents a self-signed certificate chain no client CA bundle can verify — plugin
and auth boots failed at migration/driver with `self signed certificate in
certificate chain`. Those hosts are VPC-scoped private traffic, so they now fall
into the same no-TLS bucket as `localhost` / `host.docker.internal`.
