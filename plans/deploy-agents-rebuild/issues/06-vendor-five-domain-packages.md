# 06: Vendor the five domain packages

**What to build:** Copy the five domain packages from NEARFDE/near-intents-agent-api —
wire contracts, OutLayer custody client, relay client, owner-proof verification, and
database schema — into this monorepo as private workspace packages. Names unchanged,
logic unchanged. Adapt only their build scripts to this repo's toolchain and satisfy
their dependencies from our catalog. Record the upstream SHA each package was copied at
and the refresh procedure (re-copy at a pinned SHA) so upstream sync stays mechanical.

**Blocked by:** None (can start immediately — parallel with the deploy stream).

**Status:** ready-for-agent

- [ ] Five packages vendored as private workspace packages with unchanged names and logic
- [ ] All typecheck under this repo's TS 7 toolchain (mechanical fixups only, no restructuring)
- [ ] Build outputs resolve through workspace resolution (the "bun link" experience, committed and CI-safe)
- [ ] Upstream SHA + refresh procedure recorded in each vendored package
- [ ] Repo gates green: typecheck, lint, test
