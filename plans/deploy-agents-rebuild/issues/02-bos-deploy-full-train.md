# 02: `bos deploy` — the full train

**What to build:** The deploy command becomes the single entry point for the whole
deploy train: preflight → build workspaces → upload dists to bundle storage → publish
config to FastKV → verify published → build the universal runtime image and push to GHCR
pinned by SHA tag (plus latest), capturing the digest → deploy to Railway pull-only via
a thin image-reference dockerfile pinned to the pushed digest. The legacy Railway
redeploy path (which can never ship new bytes) is deleted. Image and Railway legs
degrade gracefully — skip with a notice when docker/GHCR credentials or the Railway
token/service are absent — so child projects use the same command for
build+upload+publish only.

**Blocked by:** 01 (preflight-ordered publish engine).

**Status:** ready-for-agent

- [ ] One command runs the full train locally against staging or production
- [ ] Railway deploys the CI-pushed digest and never rebuilds the image itself
- [ ] Deployed image identity is digest-pinned and reported in the command output
- [ ] Without docker/GHCR or Railway configuration the command still completes
      build+upload+publish cleanly with a skip notice
- [ ] No Railway-redeploy code remains anywhere in the CLI
- [ ] Image ref is configurable (runtime config / env) with a sensible default derived
      from the repository
