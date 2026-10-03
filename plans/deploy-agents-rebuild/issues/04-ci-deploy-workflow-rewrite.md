# 04: CI deploy workflow rewrite

**What to build:** The production deploy workflow collapses to its essential chain:
checkout the CI-validated SHA → install dependencies → GHCR login → run the deploy
command with the storage, NEAR, and Railway credentials → mf-check retry gate → remote
smoke test. All manual prerequisite build steps and commented-out blocks are deleted.
The standalone docker workflow is deleted (absorbed into the deploy train). The staging
workflow runs the same train with staging credentials and the testnet identity.

**Blocked by:** 02 (bos deploy — the full train), 03 (command cleanup).

**Status:** ready-for-agent

- [ ] Deploy workflow: checkout SHA → install → login → deploy command → mf check → smoke, nothing else
- [ ] GHCR push permissions enabled; the docker workflow file is deleted
- [ ] Staging workflow runs the same train with testnet credentials and staging Railway service
- [ ] mf check retry loop and remote smoke run after every deploy, on the validated SHA
