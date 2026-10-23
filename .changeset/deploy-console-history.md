---
"api": minor
"ui": minor
---

Deploy console history surface (ADR 0035): a `hosting.listDeploys` api route resolves any namespace's per-deploy audit manifests from the FastKV registry (public reads, session/api-key gated) into deploy summaries — fingerprint, image pin in force, platform pin, `rolledBackFrom` marker — and a `/deploys` authenticated page renders the history list with namespace switching.
