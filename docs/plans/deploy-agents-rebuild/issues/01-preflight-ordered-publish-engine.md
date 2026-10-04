# 01: Preflight-ordered publish engine

**What to build:** Split the FastKV publish pipeline into a fail-fast preflight phase and
an execute phase. Today a missing storage/CDN credential is discovered only after the
full workspace build train has run. Preflight resolves, in order: config validity
(account/gateway, staging resolution), signing strategy (NEAR key / CLI session / gasless
wallet), session-account match, storage/CDN credentials, and only then executes
build → upload → publish → confirm. Every preflight failure returns an actionable
message before any expensive work.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A deploy with missing storage credentials fails in seconds, before any workspace build starts
- [ ] A deploy with a bad or mismatched signing identity fails before any build starts
- [ ] Preflight ordering is covered by unit tests (credential failure aborts pre-build)
- [ ] Successful deploys behave and print exactly as before
- [ ] Existing publish auth-guard and confirmation tests updated and passing
