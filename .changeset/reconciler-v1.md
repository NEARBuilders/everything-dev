---
"api": minor
---

Reconciler v1 (ADR 0035, plan 055 ticket 08): a platform-side watcher in the api shell converges configured namespaces to their latest published fingerprint via the hosting adapter — publish becomes the deploy action. Bounded poll cadence, idempotent no-op on unchanged fingerprint, mid-life stopped instances restarted on their pin, convergence failures surfaced as drift via `POST /hosting/reconciler/status`. Per-runtime database provisioning (database-per-runtime on the platform Postgres, two `runtime_<slug>_*` databases) rides convergence when the platform DB is postgres; disabled by default (empty watch list installs no adapter and requires no alchemy).
